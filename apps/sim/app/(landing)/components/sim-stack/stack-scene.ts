import {
  ACESFilmicToneMapping,
  type BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  HemisphereLight,
  Line,
  type Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  RectAreaLight,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import {
  distanceToSegment,
  isFrontFacingEdge,
  pickLayerEdge,
} from '@/app/(landing)/components/sim-stack/stack-hit-testing'
import { SLAB, STACK_CAMERA } from '@/app/(landing)/components/sim-stack/stack-layout'
import { createSlab, createSlabGeometry } from '@/app/(landing)/components/sim-stack/stack-slab'
import {
  getStackAssemblyProgress,
  getStackLayerProgress,
  getStackShadowStrength,
  getStackSpacing,
  getStackSurfaceProgress,
  STACK_LAYER_REST,
  STACK_PLAYBACK_END,
} from '@/app/(landing)/components/sim-stack/stack-timeline'

interface StackSceneState {
  progress: number
  active: number
  dark: boolean
}

export interface StackInspection {
  index: number
  progress: number
}

export interface StackScene {
  update: (state: StackSceneState) => void
  setVisible: (visible: boolean) => void
  dispose: () => void
}

/** A soft contact shadow grounds the stack without a long shadow across the controls. */
function createContactShadow() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Stack shadow requires a 2D canvas')
  context.filter = 'blur(24px)'
  context.fillStyle = '#000000'
  context.beginPath()
  context.roundRect(70, 70, 372, 372, (SLAB.cornerRadius / SLAB.width) * 372)
  context.fill()
  return new CanvasTexture(canvas)
}

/** Render on scene changes and while cursor orbit settles; release GPU resources on unmount. */
export function createStackScene(
  host: HTMLDivElement,
  onContextLost: () => void,
  onInspect: (inspection: StackInspection | null) => void
): StackScene {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0, 0)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.domElement.setAttribute('aria-hidden', 'true')

  RectAreaLightUniformsLib.init()
  const scene = new Scene()
  const camera = new OrthographicCamera(-6, 6, 5, -5, 0.1, 100)
  const room = new RoomEnvironment()
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(room, 0.04)
  scene.environment = environment.texture
  room.dispose()
  pmrem.dispose()

  const ambient = new HemisphereLight('#ffffff', '#a8acb5', 1.2)
  const key = new DirectionalLight('#ffffff', 3.5)
  key.position.set(-3, 10, -5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -8
  key.shadow.camera.right = 8
  key.shadow.camera.top = 8
  key.shadow.camera.bottom = -8
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 32
  key.shadow.normalBias = 0.008
  key.shadow.bias = -0.00003
  key.shadow.radius = 28
  const rim = new DirectionalLight('#e6edff', 1.4)
  rim.position.set(5, 4, -5)
  const softbox = new RectAreaLight('#ffffff', 2, 16, 10)
  softbox.position.set(-6, 14, 6)
  softbox.lookAt(0, 0, 0)
  scene.add(ambient, key, rim, softbox)

  const geometry = createSlabGeometry()
  const fontFamily = getComputedStyle(host).fontFamily
  const textureOptions = {
    size: Math.min(host.clientWidth < 700 ? 1024 : 2048, renderer.capabilities.maxTextureSize),
    anisotropy: Math.min(16, renderer.capabilities.getMaxAnisotropy()),
  }
  const slabs = STACK_LAYERS.map((_, index) =>
    createSlab(geometry, index, fontFamily, textureOptions)
  )
  for (const slab of slabs) scene.add(slab.group)
  const shadowMaterial = new MeshBasicMaterial({
    map: createContactShadow(),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  })
  const ground = new Mesh(new PlaneGeometry(8, 8), shadowMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.3
  scene.add(ground)

  let state: StackSceneState = { progress: 0, active: 0, dark: false }
  let visible = false
  let disposed = false
  let frame = 0
  let width = 1
  let height = 1
  let topInset = 0
  let resizePending = true
  const pointerSurface = host.closest<HTMLElement>('[data-stack-stage]') ?? host
  const pointerMotion = window.matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
  )
  const orbit = { x: 0, y: 0, targetX: 0, targetY: 0 }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const ghostAmounts = slabs.map(() => 0)
  let coverSpread = 0
  let inspected: number | null = null
  let previousTime = 0
  const selectInspection = (index: number | null) => {
    if (index === inspected) return
    inspected = index
    onInspect(index === null ? null : { index, progress: index + STACK_LAYER_REST })
    pointerSurface.classList.toggle('cursor-pointer', index !== null)
    schedule()
  }
  const render = (time: number) => {
    frame = 0
    if (disposed || !visible || document.hidden) return
    if (resizePending) {
      resizePending = false
      const nextWidth = Math.max(1, host.clientWidth)
      const nextHeight = Math.max(1, host.clientHeight)
      const pixelRatio = Math.min(window.devicePixelRatio, 2)
      topInset = Math.min(
        nextHeight * 0.65,
        Number.parseFloat(getComputedStyle(host).getPropertyValue('--stack-scene-inset')) || 0
      )
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio)
      if (width !== nextWidth || height !== nextHeight) {
        width = nextWidth
        height = nextHeight
        renderer.setSize(width, height, false)
      }
    }
    const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 60
    const damping = 1 - Math.exp(-delta / 0.2)
    orbit.x += (orbit.targetX - orbit.x) * damping
    orbit.y += (orbit.targetY - orbit.y) * damping
    const settling = Math.abs(orbit.targetX - orbit.x) + Math.abs(orbit.targetY - orbit.y) > 0.0001
    if (!settling) {
      orbit.x = orbit.targetX
      orbit.y = orbit.targetY
    }
    const spreadTarget = inspected !== null ? 1 : 0
    coverSpread = reducedMotion.matches
      ? spreadTarget
      : coverSpread + (spreadTarget - coverSpread) * damping
    const spreading = Math.abs(coverSpread - spreadTarget) > 0.001
    if (!spreading) coverSpread = spreadTarget
    composePositions()
    composeCamera()
    composeLighting()
    let ghostSettling = false
    ghostAmounts.forEach((current, index) => {
      const target = inspected !== null && index > inspected ? 1 : 0
      const next = reducedMotion.matches
        ? target
        : current + (target - current) * (1 - Math.exp(-delta / 0.14))
      ghostAmounts[index] = Math.abs(next - target) < 0.002 ? target : next
      ghostSettling ||= ghostAmounts[index] !== target
    })
    slabs.forEach((slab, index) => {
      slab.inspect(ghostAmounts[index])
      slab.shadowStrength.value =
        getStackShadowStrength(state.progress, index) * (1 - (ghostAmounts[index + 1] ?? 0))
      slab.draw(
        getStackLayerProgress(state.progress, index).drawing,
        width < 700,
        getStackSurfaceProgress(state.progress, index).label,
        state.dark
      )
    })
    renderer.render(scene, camera)
    const animating = settling || spreading || ghostSettling
    previousTime = animating ? time : 0
    if (animating) schedule()
  }
  const schedule = () => {
    if (!frame && visible && !disposed && !document.hidden) frame = requestAnimationFrame(render)
  }
  const getSceneSpacing = () => SLAB.gap * getStackSpacing(state.progress) + coverSpread * 0.1
  const composePositions = () => {
    const spacing = getSceneSpacing()
    slabs.forEach((slab, index) => {
      const { entrance } = getStackLayerProgress(state.progress, index)
      const eased = entrance * entrance * (3 - 2 * entrance)
      slab.group.position.y = index * spacing + (1 - eased) * 5.5
      slab.group.rotation.y = (1 - eased) * -0.06
    })
  }
  const composeCamera = () => {
    const modelHeight = Math.max(1, height - topInset)
    const aspect = width / modelHeight
    const viewHeight =
      Math.max(8.8 + getStackAssemblyProgress(state.progress) * 0.22, 9.4 / aspect) /
      (width < 640 ? 1.14 : 1)
    camera.left = (-viewHeight * aspect) / 2
    camera.right = (viewHeight * aspect) / 2
    camera.top = viewHeight / 2 + (topInset / modelHeight) * viewHeight
    camera.bottom = -viewHeight / 2
    const center =
      (getStackAssemblyProgress(state.progress) * getSceneSpacing() + SLAB.thickness) / 2
    const radius = Math.hypot(STACK_CAMERA.x, STACK_CAMERA.y, STACK_CAMERA.z)
    const azimuth = Math.atan2(STACK_CAMERA.x, STACK_CAMERA.z) + orbit.x * 0.16
    const elevation = Math.asin(STACK_CAMERA.y / radius) + orbit.y * 0.09
    const horizontalRadius = radius * Math.cos(elevation)
    camera.position.set(
      horizontalRadius * Math.sin(azimuth),
      center + radius * Math.sin(elevation),
      horizontalRadius * Math.cos(azimuth)
    )
    camera.lookAt(0, center, 0)
    camera.updateProjectionMatrix()
  }
  const composeLighting = () => {
    key.position.set(-3 + orbit.x * 0.8, 10 - orbit.y * 0.4, -5 + orbit.y * 0.5)
    key.intensity = (state.dark ? 3 : 4) * (1 + orbit.x * 0.055 - orbit.y * 0.035)
    softbox.position.set(-6 + orbit.x * 1.6, 14 - orbit.y * 0.65, 6 + orbit.x * 0.6)
    softbox.lookAt(0, 0, 0)
    softbox.intensity = 2 * (1 + orbit.x * 0.12 - orbit.y * 0.06)
    rim.position.set(5 - orbit.x * 0.8, 4 + orbit.y * 0.4, -5)
    rim.intensity = 1.4 * (1 - orbit.x * 0.08)
  }
  const resize = () => {
    resizePending = true
    schedule()
  }
  const update = (next: StackSceneState) => {
    state = next
    if (state.progress < STACK_PLAYBACK_END - 0.01) {
      coverSpread = 0
      selectInspection(null)
    }
    const { progress, dark } = state
    slabs.forEach((slab, index) => {
      const { entrance } = getStackLayerProgress(progress, index)
      const surface = getStackSurfaceProgress(progress, index)
      slab.reveal(surface.outline, surface.fill)
      slab.shadowStrength.value = getStackShadowStrength(progress, index)
      slab.group.visible = entrance > 0.005
      slab.face.color.set(dark ? '#3a3a3a' : '#f1f2f3')
      slab.face.metalness = dark ? 0.6 : 0.4
      slab.face.roughness = dark ? 0.36 : 0.28
      slab.face.envMapIntensity = dark ? 0.45 : 0.65
      slab.edge.color.set(dark ? '#4c4c4c' : '#e2e5e8')
      slab.edge.roughness = dark ? 0.3 : 0.2
      slab.ink.color.set('#909090')
    })
    ambient.groundColor.set(dark ? '#acacac' : '#a8acb5')
    rim.color.set(dark ? '#ededed' : '#e6edff')
    ambient.intensity = dark ? 0.6 : 0.7
    scene.environmentIntensity = dark ? 0.65 : 0.8
    shadowMaterial.opacity = (dark ? 0.3 : 0.16) * getStackSurfaceProgress(progress, 0).fill
    renderer.toneMappingExposure = dark ? 0.85 : 0.95
    composeCamera()
    schedule()
  }
  const resetOrbit = () => {
    selectInspection(null)
    orbit.targetX = 0
    orbit.targetY = 0
    if (!pointerMotion.matches || !visible || document.hidden) {
      orbit.x = 0
      orbit.y = 0
      previousTime = 0
    }
    schedule()
  }
  const inspectPointer = (event: PointerEvent) => {
    if (state.progress < STACK_PLAYBACK_END - 0.01) return
    if (event.target instanceof Element && event.target.closest('button, a')) {
      selectInspection(null)
      return
    }
    const bounds = host.getBoundingClientRect()
    const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    const projected = new Vector3()
    const world = new Vector3()
    const previousWorld = new Vector3()
    const towardCamera = camera.getWorldDirection(new Vector3()).negate()
    const edgeHits = slabs.map((slab, index) => {
      const positions = slab.outline.geometry.getAttribute('position')
      let distance = Number.POSITIVE_INFINITY
      let previous = { x: 0, y: 0 }
      for (let point = 0; point < positions.count; point += 4) {
        world.fromBufferAttribute(positions, point).applyMatrix4(slab.group.matrixWorld)
        projected.copy(world).project(camera)
        const current = {
          x: ((projected.x + 1) / 2) * bounds.width,
          y: ((1 - projected.y) / 2) * bounds.height,
        }
        if (point > 0 && isFrontFacingEdge(previousWorld, world, towardCamera)) {
          distance = Math.min(distance, distanceToSegment(cursor, previous, current))
        }
        previousWorld.copy(world)
        previous = current
      }
      return { index, distance }
    })
    selectInspection(pickLayerEdge(edgeHits, inspected))
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!visible) return
    inspectPointer(event)
    if (!pointerMotion.matches || event.pointerType !== 'mouse') return
    const bounds = pointerSurface.getBoundingClientRect()
    orbit.targetX = Math.max(
      -1,
      Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1)
    )
    orbit.targetY = Math.max(
      -1,
      Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1)
    )
    schedule()
  }
  const handleContextLost = (event: Event) => {
    event.preventDefault()
    onContextLost()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost)
  document.addEventListener('visibilitychange', resetOrbit)
  window.addEventListener('blur', resetOrbit)
  pointerMotion.addEventListener('change', resetOrbit)
  pointerSurface.addEventListener('pointermove', handlePointerMove, { passive: true })
  pointerSurface.addEventListener('pointerdown', inspectPointer, { passive: true })
  pointerSurface.addEventListener('pointerleave', resetOrbit)
  pointerSurface.addEventListener('pointercancel', resetOrbit)
  host.appendChild(renderer.domElement)
  resize()

  return {
    update,
    setVisible(next) {
      visible = next
      if (!visible) resetOrbit()
      schedule()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', resetOrbit)
      window.removeEventListener('blur', resetOrbit)
      pointerMotion.removeEventListener('change', resetOrbit)
      pointerSurface.classList.remove('cursor-pointer')
      pointerSurface.removeEventListener('pointermove', handlePointerMove)
      pointerSurface.removeEventListener('pointerdown', inspectPointer)
      pointerSurface.removeEventListener('pointerleave', resetOrbit)
      pointerSurface.removeEventListener('pointercancel', resetOrbit)
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      const geometries = new Set<BufferGeometry>()
      const materials = new Set<Material>()
      const textures = new Set<Texture>()
      scene.traverse((object) => {
        if (!(object instanceof Mesh) && !(object instanceof Line)) return
        geometries.add(object.geometry)
        const list = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of list) {
          materials.add(material)
          for (const value of Object.values(material)) {
            if (value instanceof Texture) textures.add(value)
          }
        }
      })
      for (const item of geometries) item.dispose()
      for (const item of materials) item.dispose()
      for (const item of textures) item.dispose()
      environment.dispose()
      key.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
