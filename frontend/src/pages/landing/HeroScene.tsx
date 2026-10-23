import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'

// One on-demand renderer. No postprocessing or perpetual animation loop.
export default function HeroScene() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const hero = element.closest<HTMLElement>('.lp-hero')!
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) }
    catch { element.dataset.state = 'fallback'; return }
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const mobile = matchMedia('(max-width: 767px)')
    renderer.setPixelRatio(Math.min(devicePixelRatio, navigator.hardwareConcurrency <= 4 ? 1 : 1.5))
    renderer.setClearColor(0, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.55
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    element.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xfff4df, 0x47666b, 2.8))
    const sun = new THREE.DirectionalLight(0xffd7a2, 5)
    sun.position.set(-12, 9, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 8, bottom: -8 })
    sun.shadow.bias = -0.001
    scene.add(sun)
    const rim = new THREE.DirectionalLight(0x95dae0, 3)
    rim.position.set(8, 3, -6)
    scene.add(rim)
    const world = new THREE.Group()
    scene.add(world)
    const face = new THREE.MeshPhongMaterial({ color: 0x173e45, specular: 0x799596, shininess: 75 })
    const edge = new THREE.MeshPhongMaterial({ color: 0x9b7959, specular: 0xe3b17e, shininess: 90 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x739da0, metalness: 0.65, roughness: 0.2 })
    const ivory = new THREE.MeshStandardMaterial({ color: 0xf1eae0, metalness: 0.3, roughness: 0.35 })
    const box = new THREE.BoxGeometry(1, 1, 1)
    for (let i = 0; i < 28; i++) {
      const building = new THREE.Mesh(box, i % 3 ? glass : ivory)
      const side = i % 2 ? -1 : 1
      const h = 0.15 + ((i * 7) % 9) * 0.09
      building.position.set(side * (7.8 + (i % 7) * 0.85), h / 2 - 0.06, -4 + Math.floor(i / 7) * 2.5)
      building.scale.set(0.35 + i % 3 * 0.2, h, 0.7)
      building.castShadow = true
      world.add(building)
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), new THREE.ShadowMaterial({ color: 0x132d32, opacity: 0.24 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.09
    ground.receiveShadow = true
    world.add(ground)
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-16, 0, 3), new THREE.Vector3(-5, 0, 4), new THREE.Vector3(5, 0, 2.5), new THREE.Vector3(14, 0, -4)])
    const path = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.025, 4, false), new THREE.MeshBasicMaterial({ color: 0xe7ad72 }))
    world.add(path)
    let dead = false, visible = true, ready = false, frame = 0, target = 0, current = 0, intro = 0
    const started = performance.now()
    const render = () => {
      frame = 0
      if (dead || !visible || document.hidden) return
      current += (target - current) * 0.09
      intro = reduced.matches ? 1 : Math.min(1, (performance.now() - started) / 1400)
      const aspect = element.clientWidth / Math.max(1, element.clientHeight)
      const distance = Math.max(15.8, 21 / aspect)
      const p = reduced.matches ? 0 : current
      camera.position.set(0.5 + p * 1.9, 3.0 - p * 0.7, distance + (1 - intro) * 0.8 - p * 6)
      camera.lookAt(0, 1.0 + p * 0.45, 0)
      world.rotation.y = -0.055 + p * 0.1
      renderer.render(scene, camera)
      element.dataset.progress = current.toFixed(3)
      if (ready) { element.dataset.state = 'ready'; hero.classList.add('has-scene') }
      if (Math.abs(target - current) > 0.0004 || intro < 1) frame = requestAnimationFrame(render)
    }
    const request = () => { if (!frame && !dead && visible && !document.hidden) frame = requestAnimationFrame(render) }
    const scroll = () => {
      target = Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / (hero.offsetHeight * 0.8)))
      request()
    }
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
      renderer.shadowMap.enabled = !mobile.matches
      request()
    }
    const abort = new AbortController()
    fetch('/landing/optimer_regular.typeface.json', { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error('Font unavailable')
      return response.json()
    }).then(data => {
      if (dead) return
      const geometry = new TextGeometry('AUTOINSIGHT', { font: new FontLoader().parse(data), size: 2.25, depth: 0.48, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.028, bevelSize: 0.018, bevelSegments: 2 })
      geometry.computeBoundingBox()
      geometry.translate(-geometry.boundingBox!.max.x / 2, 0, 0)
      const text = new THREE.Mesh(geometry, [face, edge])
      text.castShadow = true
      world.add(text)
      ready = true
      element.dataset.geometry = `extruded:${geometry.parameters.options.depth}`
      request()
    }).catch(() => { if (!dead) element.dataset.state = 'fallback' })
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) { scroll(); request() } else { cancelAnimationFrame(frame); frame = 0 } })
    observer.observe(hero)
    const sizeObserver = new ResizeObserver(resize)
    sizeObserver.observe(element)
    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0 } else request() }
    const onLost = (event: Event) => { event.preventDefault(); hero.classList.remove('has-scene'); element.dataset.state = 'fallback'; cancelAnimationFrame(frame); frame = 0 }
    const onRestored = () => { request() }
    renderer.domElement.addEventListener('webglcontextlost', onLost)
    renderer.domElement.addEventListener('webglcontextrestored', onRestored)
    window.addEventListener('scroll', scroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', request)
    resize(); scroll()
    return () => {
      dead = true; abort.abort(); cancelAnimationFrame(frame)
      observer.disconnect(); sizeObserver.disconnect()
      window.removeEventListener('scroll', scroll)
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', request)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored)
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
      scene.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)) } })
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
      face.dispose(); edge.dispose(); sun.shadow.dispose()
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
      hero.classList.remove('has-scene')
    }
  }, [])
  return <div className="lp-webgl" ref={host} aria-hidden="true" data-state="loading" />
}

