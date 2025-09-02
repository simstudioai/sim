'use client'

import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Particles')

interface ShaderUniforms {
  u_time: { type: string; value: number }
  u_frequency: { type: string; value: number }
  u_red: { type: string; value: number }
  u_green: { type: string; value: number }
  u_blue: { type: string; value: number }
}

interface ParticlesProps {
  audioLevels: number[]
  isListening: boolean
  isPlayingAudio: boolean
  isStreaming: boolean
  isMuted: boolean
  isProcessingInterruption?: boolean
  className?: string
}

class SimpleBloomComposer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.Camera
  private bloomScene: THREE.Scene
  private bloomMaterial: THREE.ShaderMaterial
  private renderTarget: THREE.WebGLRenderTarget
  private quad: THREE.Mesh

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera

    this.bloomScene = new THREE.Scene()

    this.renderTarget = new THREE.WebGLRenderTarget(
      renderer.domElement.width,
      renderer.domElement.height,
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      }
    )

    this.bloomMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        strength: { value: 1.5 },
        threshold: { value: 0.3 },
        radius: { value: 0.8 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float strength;
        uniform float threshold;
        uniform float radius;
        varying vec2 vUv;
        
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          
          // Simple bloom effect
          float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          if (brightness > threshold) {
            color.rgb *= strength;
          }
          
          gl_FragColor = color;
        }
      `,
    })

    const geometry = new THREE.PlaneGeometry(2, 2)
    this.quad = new THREE.Mesh(geometry, this.bloomMaterial)
    this.bloomScene.add(this.quad)
  }

  render() {
    this.renderer.setRenderTarget(this.renderTarget)
    this.renderer.render(this.scene, this.camera)

    this.bloomMaterial.uniforms.tDiffuse.value = this.renderTarget.texture
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.bloomScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1))
  }

  setSize(width: number, height: number) {
    this.renderTarget.setSize(width, height)
  }

  dispose() {
    this.renderTarget.dispose()
    this.bloomMaterial.dispose()
  }
}

const vertexShader = `
vec3 mod289(vec3 x)
{
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x)
{
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x)
{
  return mod289(((x*34.0)+10.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

vec3 fade(vec3 t) {
  return t*t*t*(t*(t*6.0-15.0)+10.0);
}

float pnoise(vec3 P, vec3 rep)
{
  vec3 Pi0 = mod(floor(P), rep); // Integer part, modulo period
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep); // Integer part + 1, mod period
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P); // Fractional part for interpolation
  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}

uniform float u_time;
uniform float u_frequency;

void main() {
  float noise = 5. * pnoise(position + u_time, vec3(10.));

  float displacement = (u_frequency / 30.) * (noise / 10.);

  vec3 newPosition = position + normal * displacement;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`

const fragmentShader = `
uniform float u_red;
uniform float u_blue;
uniform float u_green;

void main() {
    gl_FragColor = vec4(vec3(u_red, u_green, u_blue), 1.0);
}
`

export function ParticlesVisualization({
  audioLevels,
  isListening,
  isPlayingAudio,
  isStreaming,
  isMuted,
  isProcessingInterruption,
  className,
}: ParticlesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const uniformsRef = useRef<ShaderUniforms | null>(null)
  const clockRef = useRef<THREE.Clock | null>(null)
  const bloomComposerRef = useRef<SimpleBloomComposer | null>(null)
  const animationFrameRef = useRef<number>(0)
  const mouseRef = useRef({ x: 0, y: 0 })
  const isInitializedRef = useRef(false)

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = 0
    }

    if (bloomComposerRef.current) {
      bloomComposerRef.current.dispose()
      bloomComposerRef.current = null
    }

    if (rendererRef.current) {
      if (rendererRef.current.domElement?.parentNode) {
        rendererRef.current.domElement.parentNode.removeChild(rendererRef.current.domElement)
      }
      rendererRef.current.dispose()
      rendererRef.current = null
    }

    sceneRef.current = null
    cameraRef.current = null
    meshRef.current = null
    uniformsRef.current = null
    clockRef.current = null
    isInitializedRef.current = false
  }, [])

  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return

    const container = containerRef.current
    const containerWidth = 400
    const containerHeight = 400

    isInitializedRef.current = true

    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(containerWidth, containerHeight)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, containerWidth / containerHeight, 0.1, 1000)
    camera.position.set(0, -2, 14)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const uniforms = {
      u_time: { type: 'f', value: 0.0 },
      u_frequency: { type: 'f', value: 0.0 },
      u_red: { type: 'f', value: 0.8 },
      u_green: { type: 'f', value: 0.6 },
      u_blue: { type: 'f', value: 1.0 },
    }
    uniformsRef.current = uniforms

    let mat: THREE.Material
    try {
      mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
      })
    } catch (error) {
      logger.error('❌ Shader compilation error, using fallback material:', error)
      mat = new THREE.MeshBasicMaterial({
        color: 0xb794f6, // Light purple color
        wireframe: true,
      })
    }

    const geo = new THREE.IcosahedronGeometry(4, 30) // Match tutorial: radius 4, subdivisions 30
    const mesh = new THREE.Mesh(geo, mat)

    if (mat instanceof THREE.ShaderMaterial || mat instanceof THREE.MeshBasicMaterial) {
      mat.wireframe = true
    }

    scene.add(mesh)
    meshRef.current = mesh

    const bloomComposer = new SimpleBloomComposer(renderer, scene, camera)
    bloomComposerRef.current = bloomComposer

    const clock = new THREE.Clock()
    clockRef.current = clock

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const windowHalfX = containerWidth / 2
      const windowHalfY = containerHeight / 2
      mouseRef.current.x = (e.clientX - rect.left - windowHalfX) / 100
      mouseRef.current.y = (e.clientY - rect.top - windowHalfY) / 100
    }

    container.addEventListener('mousemove', handleMouseMove)

    const updateCameraPosition = () => {
      if (!camera || !scene) return
      camera.position.x += (mouseRef.current.x - camera.position.x) * 0.05
      camera.position.y += (-mouseRef.current.y - camera.position.y) * 0.5
      camera.lookAt(scene.position)
    }

    const calculateAudioIntensity = (elapsedTime: number, avgLevel: number) => {
      const baselineIntensity = 8 + Math.sin(elapsedTime * 0.5) * 3
      let audioIntensity = baselineIntensity

      if (isMuted) {
        // When muted, only show minimal baseline animation
        audioIntensity = baselineIntensity * 0.2
      } else if (isProcessingInterruption) {
        // Special pulsing effect during interruption processing
        audioIntensity = 35 + Math.sin(elapsedTime * 4) * 10
      } else if (isPlayingAudio) {
        // Strong animation when AI is speaking - use simulated levels + enhancement
        const aiIntensity = 60 + Math.sin(elapsedTime * 3) * 20
        audioIntensity = Math.max(avgLevel * 0.8, aiIntensity)
      } else if (isStreaming) {
        // Pulsing animation when AI is thinking/streaming
        audioIntensity = 40 + Math.sin(elapsedTime * 2) * 15
      } else if (isListening && avgLevel > 0) {
        // Scale user input more dramatically for better visual feedback
        const userVoiceIntensity = avgLevel * 2.5 // Amplify user voice significantly
        audioIntensity = Math.max(userVoiceIntensity, baselineIntensity * 1.5)

        // Add some dynamic variation based on audio levels
        const variationFactor = Math.min(avgLevel / 20, 1) // Cap at reasonable level
        audioIntensity += Math.sin(elapsedTime * 8) * (10 * variationFactor)
      } else {
        // Idle state - subtle breathing animation
        audioIntensity = baselineIntensity
      }

      // Clamp to reasonable range
      audioIntensity = Math.max(audioIntensity, 3) // Never completely still
      audioIntensity = Math.min(audioIntensity, 120) // Prevent excessive animation

      return audioIntensity
    }

    const updateShaderColors = (
      uniforms: ShaderUniforms,
      elapsedTime: number,
      avgLevel: number
    ) => {
      if (isMuted) {
        // Muted: dim purple-gray
        uniforms.u_red.value = 0.25
        uniforms.u_green.value = 0.1
        uniforms.u_blue.value = 0.5
      } else if (isProcessingInterruption) {
        // Interruption: bright purple
        uniforms.u_red.value = 0.6
        uniforms.u_green.value = 0.2
        uniforms.u_blue.value = 0.9
      } else if (isPlayingAudio) {
        // AI speaking: brand purple (#701FFC)
        uniforms.u_red.value = 0.44
        uniforms.u_green.value = 0.12
        uniforms.u_blue.value = 0.99
      } else if (isListening && avgLevel > 10) {
        // User speaking: lighter purple with intensity-based variation
        const intensity = Math.min(avgLevel / 50, 1)
        uniforms.u_red.value = 0.35 + intensity * 0.15
        uniforms.u_green.value = 0.1 + intensity * 0.1
        uniforms.u_blue.value = 0.8 + intensity * 0.2
      } else if (isStreaming) {
        // AI thinking: pulsing brand purple
        const pulse = (Math.sin(elapsedTime * 2) + 1) / 2
        uniforms.u_red.value = 0.35 + pulse * 0.15
        uniforms.u_green.value = 0.08 + pulse * 0.08
        uniforms.u_blue.value = 0.95 + pulse * 0.05
      } else {
        // Default idle: soft brand purple
        uniforms.u_red.value = 0.4
        uniforms.u_green.value = 0.15
        uniforms.u_blue.value = 0.9
      }
    }

    const animate = () => {
      if (!camera || !clock || !scene || !bloomComposer || !isInitializedRef.current) return

      updateCameraPosition()

      if (uniforms) {
        const elapsedTime = clock.getElapsedTime()
        const avgLevel = audioLevels.reduce((sum, level) => sum + level, 0) / audioLevels.length

        uniforms.u_time.value = elapsedTime

        const audioIntensity = calculateAudioIntensity(elapsedTime, avgLevel)
        updateShaderColors(uniforms, elapsedTime, avgLevel)

        uniforms.u_frequency.value = audioIntensity
      }

      bloomComposer.render()
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      cleanup()
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      if (
        rendererRef.current &&
        cameraRef.current &&
        bloomComposerRef.current &&
        containerRef.current
      ) {
        const containerWidth = 400
        const containerHeight = 400

        cameraRef.current.aspect = containerWidth / containerHeight
        cameraRef.current.updateProjectionMatrix()
        rendererRef.current.setSize(containerWidth, containerHeight)
        bloomComposerRef.current.setSize(containerWidth, containerHeight)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '400px',
        height: '400px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    />
  )
}
