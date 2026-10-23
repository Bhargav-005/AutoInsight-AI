import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'

type Pose = { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number; color: THREE.Color }
const DATA_COUNT = 36
const colorSets = [0x28666b, 0x347c7e, 0x428f8d, 0x559c96, 0x245860, 0x6a9996].map(value => new THREE.Color(value))
const copper = new THREE.Color(0xc78b59)
const ivory = new THREE.Color(0xe6e7dc)
const smooth = (value: number) => value * value * (3 - 2 * value)

function stagePoses(): Pose[][] {
  return Array.from({ length: 7 }, (_, stage) => Array.from({ length: DATA_COUNT }, (_, index) => {
    let x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rz = 0
    const rx = 0
    if (stage === 0) {
      const row = Math.floor(index / 12), a = index % 12 / 12 * Math.PI * 2
      const radius = 1.02
      x = Math.cos(a) * radius; y = (row - 1) * .43; z = Math.sin(a) * radius
      sx = .55; sy = .25; sz = .36; ry = -a
    } else if (stage === 1) {
      const col = index % 6, row = Math.floor(index / 6) % 3, depth = Math.floor(index / 18)
      x = (col - 2.5) * .53; y = (row - 1) * .45; z = (depth - .5) * .52
      sx = .42; sy = .36; sz = .4
    } else if (stage === 2) {
      const col = Math.floor(index / 6), level = index % 6
      const heights = [.68, 1.06, .82, 1.46, 1.18, 1.68]
      const blockH = heights[col] / 6
      x = (col - 2.5) * .56; y = -.68 + blockH * (level + .5); z = -.08
      sx = .43; sy = blockH * .92; sz = .48; ry = (col % 2 ? .025 : -.025)
    } else if (stage === 3) {
      const layer = Math.floor(index / 12), a = (index % 12) / 12 * Math.PI * 2 + layer * .21
      const radius = layer === 1 ? .67 : 1.18
      x = Math.cos(a) * radius; y = (layer - 1) * .68 + Math.sin(a * 2) * .12; z = Math.sin(a) * radius
      sx = .23; sy = .23; sz = .23; ry = a
    } else if (stage === 4) {
      const layer = Math.floor(index / 12), a = (index % 12) / 12 * Math.PI * 2
      const radius = [.72, 1.12, 1.48][layer]
      x = Math.cos(a) * radius; y = (layer - 1) * .3; z = Math.sin(a) * radius
      sx = .2; sy = .2; sz = .2; ry = a
    } else if (stage === 5) {
      const strand = Math.floor(index / 12), step = index % 12, t = step / 11
      const radius = 1.42 * (1 - t) + .14
      const a = t * Math.PI * 2.5 + strand * Math.PI * 2 / 3
      x = Math.cos(a) * radius; y = (strand - 1) * .48 * (1 - t) + Math.sin(a) * .18; z = Math.sin(a) * radius
      sx = .19 + t * .09; sy = .19 + t * .09; sz = .19 + t * .09; ry = a
    } else {
      if (index < 6) {
        const col = index
        x = -1.02 + col * .41; y = 1.12; z = .02
        sx = [.22, .31, .19, .28, .25, .18][col]; sy = .055; sz = .035
      } else if (index < 12) {
        const col = index - 6
        x = -.98 + col * .39; y = .83; z = .02
        sx = [.31, .24, .34, .2, .29, .17][col]; sy = .035; sz = .035
      } else {
        const chartIndex = index - 12, col = Math.floor(chartIndex / 6), level = chartIndex % 6
        const heights = [3, 4, 5, 4]
        const blockH = .19
        x = -.78 + col * .52; y = -.95 + (level + .5) * blockH; z = .015
        sx = .35; sy = blockH * .72; sz = .035
        if (level >= heights[col]) { sy = .008; y = -.95 + (heights[col] + .5) * blockH }
      }
      rz = -.025
    }
    const highlight = stage === 0 ? index === 7 || index === 19 : stage === 1 ? index === 11 : stage === 2 ? index % 6 === 5 : stage === 3 ? index === 5 || index === 17 || index === 29 : stage === 4 ? index === 0 || index === 18 : stage === 5 ? index % 12 === 0 : index >= 33
    const color = stage === 6 && index < 12 ? ivory.clone() : (highlight ? copper.clone() : colorSets[(index + stage * 2) % colorSets.length].clone())
    return { x, y, z, sx, sy, sz, rx, ry, rz, color }
  }))
}

const layouts = stagePoses()
const links: [number, number][] = []
for (let i = 0; i < DATA_COUNT; i++) {
  if (i % 12 !== 11) links.push([i, i + 1])
  if (i < DATA_COUNT - 12) links.push([i, i + 12])
  if (i % 3 === 0 && i < DATA_COUNT - 6) links.push([i, i + 6])
}
const cameraPositions = [
  new THREE.Vector3(3.2, 2.5, 6.3), new THREE.Vector3(2.2, 3.1, 7.3), new THREE.Vector3(1.2, 2.1, 7.8),
  new THREE.Vector3(.5, 1.0, 8), new THREE.Vector3(2, 2.2, 7.6), new THREE.Vector3(-.5, .7, 8.4), new THREE.Vector3(2.1, 1.7, 7.3),
]
const cameraTargets = [
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .15, 0),
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(.12, .05, 0),
]

function weight(stage: number, segment: number, amount: number) { return stage === segment ? 1 - amount : stage === segment + 1 ? amount : 0 }

/** One low-cost, on-demand scene. The same 36 blocks move through every state. */
export default function ProcessScene({ track }: { track: RefObject<HTMLDivElement | null> }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current, trackElement = track.current
    if (!element || !trackElement) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) }
    catch { element.dataset.state = 'fallback'; return }
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 60)
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25))
    renderer.setClearColor(0, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.22
    renderer.outputColorSpace = THREE.SRGBColorSpace
    element.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0x9ecbce, 0x13252b, 2.1))
    scene.add(new THREE.AmbientLight(0x78999a, .55))
    const key = new THREE.DirectionalLight(0xffd5a2, 2.7); key.position.set(-4, 5, 5); scene.add(key)
    const fill = new THREE.PointLight(0x56b6b5, 18, 12); fill.position.set(3, 1, 3); scene.add(fill)
    const rim = new THREE.PointLight(0xc78353, 14, 10); rim.position.set(-3, 2, -2); scene.add(rim)

    const world = new THREE.Group(); world.scale.setScalar(1.35); scene.add(world)
    const cellGeometry = new THREE.BoxGeometry(1, 1, 1)
    const cellMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .58, roughness: .3, envMapIntensity: .72 })
    const cells = new THREE.InstancedMesh(cellGeometry, cellMaterial, DATA_COUNT)
    cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage); cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DATA_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage)
    cells.castShadow = false; cells.receiveShadow = false; cells.frustumCulled = false; world.add(cells)
    const dummy = new THREE.Object3D()
    const dbGeometry = new THREE.CylinderGeometry(1, 1, .085, 48, 1)
    const dbMaterial = new THREE.MeshStandardMaterial({ color: 0x28737a, metalness: .68, roughness: .27, transparent: true, opacity: 1, depthWrite: false })
    const dbParts = [-.43, 0, .43].map(y => { const mesh = new THREE.Mesh(dbGeometry, dbMaterial); mesh.position.y = y; mesh.scale.set(1.1, 1, 1.1); world.add(mesh); return mesh })
    const ringGeometry = new THREE.TorusGeometry(1.08, .018, 7, 56)
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x71beb8, metalness: .55, roughness: .25, transparent: true, opacity: 1, depthWrite: false })
    const dbRings = [-.43, 0, .43].map(y => { const mesh = new THREE.Mesh(ringGeometry, ringMaterial); mesh.rotation.x = Math.PI / 2; mesh.position.y = y; world.add(mesh); return mesh })
    const validationRingGeometry = new THREE.TorusGeometry(1.62, .028, 8, 80)
    const validationMaterial = new THREE.MeshStandardMaterial({ color: 0x71c4b7, metalness: .55, roughness: .24, emissive: 0x123d3b, emissiveIntensity: .7, transparent: true, opacity: 0, depthWrite: false })
    const validationRing = new THREE.Mesh(validationRingGeometry, validationMaterial); world.add(validationRing)
    const coreGeometry = new THREE.IcosahedronGeometry(.32, 1)
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x88c4bd, metalness: .48, roughness: .22, emissive: 0x255d58, emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false })
    const core = new THREE.Mesh(coreGeometry, coreMaterial); world.add(core)
    const pageGeometry = new THREE.BoxGeometry(2.55, 2.92, .045)
    const pageMaterial = new THREE.MeshBasicMaterial({ color: 0xe9e2d3, transparent: true, opacity: 0, depthWrite: true })
    const pageBackMaterial = new THREE.MeshStandardMaterial({ color: 0x91b4b1, metalness: .35, roughness: .35, transparent: true, opacity: 0, depthWrite: false })
    const pageBack = new THREE.Mesh(pageGeometry, pageBackMaterial); pageBack.position.set(.12, -.05, -.54); pageBack.rotation.y = -.08; world.add(pageBack)
    const page = new THREE.Mesh(pageGeometry, pageMaterial); page.position.set(.04, 0, -.45); page.rotation.y = -.04; world.add(page)

    const linePositions = new Float32Array(links.length * 6)
    const linkGeometry = new THREE.BufferGeometry(); linkGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage))
    const linkMaterial = new THREE.LineBasicMaterial({ color: 0x71bdb6, transparent: true, opacity: 0, depthWrite: false })
    const linkLines = new THREE.LineSegments(linkGeometry, linkMaterial); linkLines.frustumCulled = false; world.add(linkLines)
    const chartPositions = new Float32Array(6 * 3)
    const chartGeometry = new THREE.BufferGeometry(); chartGeometry.setAttribute('position', new THREE.BufferAttribute(chartPositions, 3).setUsage(THREE.DynamicDrawUsage))
    const chartMaterial = new THREE.LineBasicMaterial({ color: 0xe0a26c, transparent: true, opacity: 0, depthWrite: false })
    const chartLine = new THREE.Line(chartGeometry, chartMaterial); chartLine.frustumCulled = false; world.add(chartLine)
    const detailsMaterial = new THREE.MeshStandardMaterial({ color: 0x397d80, metalness: .22, roughness: .5, transparent: true, opacity: 0, depthWrite: false })
    const reportDetails = Array.from({ length: 5 }, (_, index) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(.42, .025, .012), index === 0 ? new THREE.MeshStandardMaterial({ color: 0xbe8153, metalness: .25, roughness: .5, transparent: true, opacity: 0, depthWrite: false }) : detailsMaterial)
      bar.position.set(-.91 + (index % 3) * .51, .42 - Math.floor(index / 3) * .12, -.39); world.add(bar); return bar
    })

    const point = (index: number, progress: number, out: THREE.Vector3) => {
      const scaled = Math.min(6, Math.max(0, progress * 6)), segment = Math.min(5, Math.floor(scaled)), amount = smooth(scaled - segment)
      const a = layouts[segment][index], b = layouts[segment + 1][index]
      return out.set(THREE.MathUtils.lerp(a.x, b.x, amount), THREE.MathUtils.lerp(a.y, b.y, amount), THREE.MathUtils.lerp(a.z, b.z, amount))
    }
    const positions = Array.from({ length: DATA_COUNT }, () => new THREE.Vector3())
    const scratchColor = new THREE.Color()
    const draw = (rawProgress: number) => {
      const progress = THREE.MathUtils.clamp(rawProgress, 0, 1)
      const scaled = Math.min(6, progress * 6), segment = Math.min(5, Math.floor(scaled)), amount = smooth(scaled - segment)
      for (let i = 0; i < DATA_COUNT; i++) {
        const a = layouts[segment][i], b = layouts[segment + 1][i]
        dummy.position.set(THREE.MathUtils.lerp(a.x, b.x, amount), THREE.MathUtils.lerp(a.y, b.y, amount), THREE.MathUtils.lerp(a.z, b.z, amount))
        dummy.rotation.set(THREE.MathUtils.lerp(a.rx, b.rx, amount), THREE.MathUtils.lerp(a.ry, b.ry, amount), THREE.MathUtils.lerp(a.rz, b.rz, amount))
        dummy.scale.set(THREE.MathUtils.lerp(a.sx, b.sx, amount), THREE.MathUtils.lerp(a.sy, b.sy, amount), THREE.MathUtils.lerp(a.sz, b.sz, amount))
        dummy.updateMatrix(); cells.setMatrixAt(i, dummy.matrix)
        scratchColor.copy(a.color).lerp(b.color, amount); cells.setColorAt(i, scratchColor)
        point(i, progress, positions[i])
      }
      cells.instanceMatrix.needsUpdate = true; if (cells.instanceColor) cells.instanceColor.needsUpdate = true
      const linkAttr = linkGeometry.getAttribute('position') as THREE.BufferAttribute
      links.forEach(([from, to], index) => {
        linkAttr.setXYZ(index * 2, positions[from].x, positions[from].y, positions[from].z)
        linkAttr.setXYZ(index * 2 + 1, positions[to].x, positions[to].y, positions[to].z)
      })
      linkAttr.needsUpdate = true

      const barTopIndices = segment === 5 ? [14, 21, 28, 33, 33, 33] : [5, 11, 17, 23, 29, 35]
      const chartAttr = chartGeometry.getAttribute('position') as THREE.BufferAttribute
      barTopIndices.forEach((index, i) => chartAttr.setXYZ(i, positions[index].x, positions[index].y + .12, positions[index].z + .16))
      chartAttr.needsUpdate = true

      const dbWeight = weight(0, segment, amount)
      dbParts.forEach(mesh => mesh.material.opacity = dbWeight * .82)
      dbRings.forEach(mesh => mesh.material.opacity = dbWeight * .92)
      validationMaterial.opacity = weight(4, segment, amount) * .94
      coreMaterial.opacity = weight(5, segment, amount) * .9
      pageMaterial.opacity = weight(6, segment, amount) * .9
      pageBackMaterial.opacity = weight(6, segment, amount) * .46
      linkMaterial.opacity = Math.max(weight(3, segment, amount) * .72, weight(4, segment, amount) * .33, weight(5, segment, amount) * .66)
      chartMaterial.opacity = Math.max(weight(2, segment, amount) * .95, weight(6, segment, amount) * .72)
      reportDetails.forEach(bar => bar.material.opacity = weight(6, segment, amount) * .68)

      const cam = cameraPositions[segment].clone().lerp(cameraPositions[segment + 1], amount)
      const target = cameraTargets[segment].clone().lerp(cameraTargets[segment + 1], amount)
      camera.position.copy(cam); camera.lookAt(target)
      validationRing.rotation.set(.03, 0, progress * .03)
      core.rotation.set(progress * .18, progress * .26, progress * .1)
      element.dataset.progress = progress.toFixed(4)
      element.dataset.segment = String(segment)
      element.dataset.mix = amount.toFixed(3)
      renderer.render(scene, camera)
    }

    let dead = false, visible = false, frame = 0, pendingProgress = 0
    const schedule = (progress: number) => { pendingProgress = progress; if (!frame && visible && !document.hidden) frame = requestAnimationFrame(() => { frame = 0; if (!dead) draw(pendingProgress) }) }
    const onProgress = (event: Event) => schedule((event as CustomEvent<number>).detail)
    const resize = () => {
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight)
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix()
      schedule(Number(trackElement.dataset.progress || 0))
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) schedule(Number(trackElement.dataset.progress || 0)); else { cancelAnimationFrame(frame); frame = 0 } }, { threshold: .02 })
    observer.observe(element)
    const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(element)
    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0 } else schedule(Number(trackElement.dataset.progress || 0)) }
    const onLost = (event: Event) => { event.preventDefault(); element.dataset.state = 'fallback'; cancelAnimationFrame(frame); frame = 0 }
    const onRestored = () => { element.dataset.state = 'ready'; schedule(Number(trackElement.dataset.progress || 0)) }
    trackElement.addEventListener('processprogress', onProgress)
    document.addEventListener('visibilitychange', onVisibility)
    renderer.domElement.addEventListener('webglcontextlost', onLost)
    renderer.domElement.addEventListener('webglcontextrestored', onRestored)
    element.dataset.state = 'ready'
    resize()
    schedule(Number(trackElement.dataset.progress || 0))
    return () => {
      dead = true; cancelAnimationFrame(frame); observer.disconnect(); sizeObserver.disconnect()
      trackElement.removeEventListener('processprogress', onProgress)
      document.removeEventListener('visibilitychange', onVisibility)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored)
      const geometries = new Set<THREE.BufferGeometry>()
      const materialResources = new Set<THREE.Material>()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line) {
          geometries.add(object.geometry)
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
          objectMaterials.forEach(material => materialResources.add(material))
        }
      })
      geometries.forEach(geometry => geometry.dispose())
      materialResources.forEach(material => material.dispose())
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    }
  }, [track])

  return <div className="lp-process-scene" ref={host} data-state="loading" aria-hidden="true">
    <div className="lp-process-fallback"><i/><i/><i/><span>Data, shaped by every step</span></div>
  </div>
}
