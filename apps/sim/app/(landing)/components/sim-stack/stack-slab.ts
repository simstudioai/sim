import {
  BufferGeometry,
  ExtrudeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderChunk,
  Shape,
  Vector3,
} from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  createStackEngraving,
  type StackTextureOptions,
} from '@/app/(landing)/components/sim-stack/stack-engraving'
import { SLAB } from '@/app/(landing)/components/sim-stack/stack-layout'

/** More filtered depth samples soften cast edges without variance-shadow light leaks. */
const STACK_SHADOW_CHUNK = ShaderChunk.shadowmap_pars_fragment.replace(
  /shadow = \([\s\S]*?\) \* 0\.2;/,
  `shadow = 0.0;
  for (int sampleIndex = 0; sampleIndex < 32; sampleIndex++) {
    shadow += texture(shadowMap, vec3(
      shadowCoord.xy + vogelDiskSample(sampleIndex, 32, phi) * radius,
      shadowCoord.z
    ));
  }
  shadow /= 32.0;`
)

function createSlabShape() {
  const x = -SLAB.width / 2
  const y = -SLAB.depth / 2
  const w = SLAB.width
  const h = SLAB.depth
  const r = SLAB.cornerRadius
  const outline = new Shape()
  outline.moveTo(x + r, y)
  outline.lineTo(x + w - r, y)
  outline.quadraticCurveTo(x + w, y, x + w, y + r)
  outline.lineTo(x + w, y + h - r)
  outline.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  outline.lineTo(x + r, y + h)
  outline.quadraticCurveTo(x, y + h, x, y + h - r)
  outline.lineTo(x, y + r)
  outline.quadraticCurveTo(x, y, x + r, y)
  return outline
}

/** Rounded outlines extruded into solid plates, with a separate polished bevel material. */
export function createSlabGeometry() {
  const geometry = new ExtrudeGeometry(createSlabShape(), {
    depth: SLAB.thickness,
    bevelEnabled: true,
    bevelThickness: SLAB.bevel,
    bevelSize: SLAB.bevel,
    bevelSegments: 12,
    steps: 1,
    curveSegments: 64,
  })
  const flatNormals = geometry.getAttribute('normal')
  /** The normal utility quantizes positions to 0.01; scale up to preserve the fine bevel rings. */
  geometry.scale(100, 100, 100)
  toCreasedNormals(geometry, Math.PI / 3)
  geometry.scale(0.01, 0.01, 0.01)
  const normals = geometry.getAttribute('normal')
  for (const group of geometry.groups) {
    if (group.materialIndex !== 0) continue
    for (let vertex = group.start; vertex < group.start + group.count; vertex++) {
      normals.setXYZ(
        vertex,
        flatNormals.getX(vertex),
        flatNormals.getY(vertex),
        flatNormals.getZ(vertex)
      )
    }
  }
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

export function createSlab(
  geometry: ExtrudeGeometry,
  index: number,
  fontFamily: string,
  textureOptions: StackTextureOptions
) {
  const face = new MeshPhysicalMaterial({
    color: '#f1f2f3',
    metalness: 0.4,
    roughness: 0.28,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.65,
  })
  const edge = new MeshStandardMaterial({
    color: '#e2e5e8',
    metalness: 1,
    roughness: 0.2,
    envMapIntensity: 1.1,
  })
  const plate = new Mesh(geometry, [face, edge])
  plate.castShadow = true
  plate.receiveShadow = true
  const engraving = createStackEngraving(index, fontFamily, textureOptions)
  const ink = new MeshStandardMaterial({
    color: '#909090',
    map: engraving.texture,
    alphaTest: 0.01,
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 0.35,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  })
  const shadowStrength = { value: 0 }
  for (const material of [face, edge, ink]) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.stackShadowStrength = shadowStrength
      shader.fragmentShader = `uniform float stackShadowStrength;\n${shader.fragmentShader}`
        .replace(
          '#include <lights_fragment_begin>',
          ShaderChunk.lights_fragment_begin.replaceAll(
            'directionalLightShadow.shadowIntensity',
            '(directionalLightShadow.shadowIntensity * stackShadowStrength)'
          )
        )
        .replace('#include <shadowmap_pars_fragment>', STACK_SHADOW_CHUNK)
    }
    material.customProgramCacheKey = () => 'stack-arrival-shadow-pcf32-v2'
  }
  const label = new Mesh(new PlaneGeometry(SLAB.width, SLAB.depth), ink)
  label.rotation.x = -Math.PI / 2
  label.position.y = SLAB.thickness + SLAB.bevel + 0.002
  label.receiveShadow = true
  const group = new Group()
  group.add(plate, label)
  const outlineGeometry = new BufferGeometry().setFromPoints(
    createSlabShape()
      .getSpacedPoints(256)
      .map((point) => new Vector3(point.x, SLAB.thickness + SLAB.bevel + 0.004, -point.y))
  )
  const outline = new Line(
    outlineGeometry,
    new LineBasicMaterial({ color: '#858585', transparent: true, depthWrite: false })
  )
  const lowerOutline = new Line(outlineGeometry, outline.material.clone())
  lowerOutline.position.y = -SLAB.thickness - SLAB.bevel
  group.add(outline, lowerOutline)
  let surfaceTrace = 0
  let surfaceFill = 1
  let ghost = 0
  const composeSurface = () => {
    const opacity = surfaceFill * (1 - ghost)
    outline.visible = ghost > 0 || (surfaceTrace > 0 && surfaceFill < 1)
    outline.geometry.setDrawRange(0, ghost > 0 ? 257 : Math.floor(surfaceTrace * 257))
    outline.material.opacity = Math.max((1 - surfaceFill) * (1 - ghost), ghost * 0.5)
    lowerOutline.visible = ghost > 0
    lowerOutline.material.opacity = ghost * 0.22
    plate.visible = opacity > 0.001
    ink.opacity = 1 - ghost
    for (const material of [face, edge]) {
      const transparent = opacity < 1
      if (material.transparent !== transparent) {
        material.transparent = transparent
        material.needsUpdate = true
      }
      material.opacity = opacity
      material.depthWrite = !transparent
    }
  }
  const reveal = (trace: number, fill: number) => {
    surfaceTrace = trace
    surfaceFill = fill
    composeSurface()
  }
  const inspect = (amount: number) => {
    ghost = amount
    composeSurface()
  }
  return {
    group,
    plate,
    outline,
    face,
    edge,
    ink,
    shadowStrength,
    reveal,
    inspect,
    draw: engraving.draw,
  }
}
