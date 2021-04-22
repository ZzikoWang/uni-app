import {
  VNode,
  nextTick,
  computed,
  ConcreteComponent,
  ComponentPublicInstance,
  ComponentInternalInstance,
} from 'vue'
import { hasOwn } from '@vue/shared'
import { useRoute, RouteLocationNormalizedLoaded } from 'vue-router'
import {
  invokeHook,
  disableScrollListener,
  createScrollListener,
  CreateScrollListenerOptions,
} from '@dcloudio/uni-core'
import { ON_REACH_BOTTOM_DISTANCE } from '@dcloudio/uni-shared'
import { usePageMeta } from './provide'
import { NavigateType } from '../../service/api/route/utils'
import { updateCurPageCssVar } from '../../helpers/cssVar'

const SEP = '$$'

const currentPagesMap = new Map<string, Page.PageInstance>()

function pruneCurrentPages() {
  currentPagesMap.forEach((page, id) => {
    if (((page as unknown) as ComponentPublicInstance).$.isUnmounted) {
      currentPagesMap.delete(id)
    }
  })
}

export function getCurrentPagesMap() {
  return currentPagesMap
}

export function getCurrentPages() {
  const curPages: Page.PageInstance[] = []
  const pages = currentPagesMap.values()
  for (const page of pages) {
    if ((page as ComponentPublicInstance).__isTabBar) {
      if ((page as ComponentPublicInstance).$.__isActive) {
        curPages.push(page)
      }
    } else {
      curPages.push(page)
    }
  }
  return curPages
}

function removeRouteCache(routeKey: string) {
  const vnode = pageCacheMap.get(routeKey)
  if (vnode) {
    pageCacheMap.delete(routeKey)
    routeCache.pruneCacheEntry!(vnode)
  }
}

export function removePage(routeKey: string, removeRouteCaches = true) {
  const pageVm = currentPagesMap.get(routeKey) as ComponentPublicInstance
  pageVm.$.__isUnload = true
  invokeHook(pageVm, 'onUnload')
  currentPagesMap.delete(routeKey)
  removeRouteCaches && removeRouteCache(routeKey)
}

let id = /*#__PURE__*/ (() => (history.state && history.state.__id__) || 1)()

export function createPageState(type: NavigateType, __id__?: number) {
  return {
    __id__: __id__ || ++id,
    __type__: type,
  }
}

function initPublicPage(route: RouteLocationNormalizedLoaded) {
  const meta = usePageMeta()
  if (!__UNI_FEATURE_PAGES__) {
    const { path, alias } = __uniRoutes[0]
    return {
      id: meta.id,
      path,
      route: alias!.substr(1),
      fullPath: path,
      options: {},
      meta,
    }
  }
  const { path } = route
  return {
    id: meta.id,
    path: path,
    route: route.meta.route,
    fullPath: route.meta.isEntry ? route.meta.pagePath : route.fullPath,
    options: {}, // $route.query
    meta,
  }
}

export function initPage(vm: ComponentPublicInstance) {
  const route = vm.$route
  const page = initPublicPage(route)
  ;(vm as any).$vm = vm
  ;(vm as any).$page = page
  vm.__isTabBar = page.meta.isTabBar!
  currentPagesMap.set(
    normalizeRouteKey(page.path, page.id),
    (vm as unknown) as Page.PageInstance
  )
}

export function normalizeRouteKey(path: string, id: number) {
  return path + SEP + id
}

export function useKeepAliveRoute() {
  const route = useRoute()
  const routeKey = computed(() =>
    normalizeRouteKey(route.path, history.state.__id__ || 1)
  )
  return {
    routeKey,
    routeCache,
  }
}

// https://github.com/vuejs/rfcs/pull/284
// https://github.com/vuejs/vue-next/pull/3414

type CacheKey = string | number | ConcreteComponent
interface KeepAliveCache {
  get(key: CacheKey): VNode | void
  set(key: CacheKey, value: VNode): void
  delete(key: CacheKey): void
  forEach(
    fn: (value: VNode, key: CacheKey, map: Map<CacheKey, VNode>) => void,
    thisArg?: any
  ): void
  pruneCacheEntry?: (cached: VNode) => void
}
const pageCacheMap = new Map<CacheKey, VNode>()
const routeCache: KeepAliveCache = {
  get(key) {
    return pageCacheMap.get(key)
  },
  set(key, value) {
    pruneRouteCache(key as string)
    pageCacheMap.set(key, value)
  },
  delete(key) {
    const vnode = pageCacheMap.get(key)
    if (!vnode) {
      return
    }
    pageCacheMap.delete(key)
  },
  forEach(fn) {
    pageCacheMap.forEach(fn)
  },
}

function isTabBarVNode(vnode: VNode): boolean {
  if (!hasOwn(vnode, '__isTabBar')) {
    const { component } = vnode
    if (component && component.refs.page) {
      const vm = component.refs.page as ComponentPublicInstance
      if (vm.$page) {
        ;(vnode as any).__isTabBar = vm.__isTabBar
      }
    }
  }
  return (vnode as any).__isTabBar
}

function pruneRouteCache(key: string) {
  const pageId = parseInt(key.split(SEP)[1])
  if (!pageId) {
    return
  }
  routeCache.forEach((vnode, key) => {
    const cPageId = parseInt((key as string).split(SEP)[1])
    if (cPageId && cPageId > pageId) {
      if (__UNI_FEATURE_TABBAR__ && isTabBarVNode(vnode)) {
        // tabBar keep alive
        return
      }
      routeCache.delete(key)
      routeCache.pruneCacheEntry!(vnode)
      nextTick(() => pruneCurrentPages())
    }
  })
}

export function onPageShow(
  instance: ComponentInternalInstance,
  pageMeta: UniApp.PageRouteMeta
) {
  updateCurPageCssVar(pageMeta)
  initPageScrollListener(instance, pageMeta)
}

let curScrollListener: (evt: Event) => any
function initPageScrollListener(
  instance: ComponentInternalInstance,
  pageMeta: UniApp.PageRouteMeta
) {
  document.removeEventListener('touchmove', disableScrollListener)
  if (curScrollListener) {
    document.removeEventListener('scroll', curScrollListener)
  }
  if (pageMeta.disableScroll) {
    return document.addEventListener('touchmove', disableScrollListener)
  }
  const { onPageScroll, onReachBottom } = instance
  const navigationBarTransparent = pageMeta.navigationBar.type === 'transparent'
  if (!onPageScroll && !onReachBottom && !navigationBarTransparent) {
    return
  }
  const opts: CreateScrollListenerOptions = {}
  const pageId = instance.proxy!.$page.id
  if (onPageScroll || navigationBarTransparent) {
    opts.onPageScroll = createOnPageScroll(
      pageId,
      onPageScroll,
      navigationBarTransparent
    )
  }
  if (onReachBottom) {
    opts.onReachBottomDistance =
      pageMeta.onReachBottomDistance || ON_REACH_BOTTOM_DISTANCE
    opts.onReachBottom = () =>
      UniViewJSBridge.publishHandler('onReachBottom', {}, pageId)
  }
  curScrollListener = createScrollListener(opts)
  // 避免监听太早，直接触发了 scroll
  requestAnimationFrame(() =>
    document.addEventListener('scroll', curScrollListener)
  )
}

function createOnPageScroll(
  pageId: number,
  onPageScroll: unknown,
  navigationBarTransparent: boolean
) {
  return (scrollTop: number) => {
    if (onPageScroll) {
      UniViewJSBridge.publishHandler('onPageScroll', { scrollTop }, pageId)
    }
    if (navigationBarTransparent) {
      UniViewJSBridge.emit(pageId + '.onPageScroll', {
        scrollTop,
      })
    }
  }
}