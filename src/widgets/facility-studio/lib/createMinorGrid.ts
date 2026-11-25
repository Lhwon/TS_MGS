/**
 * 파일명: createMinorGrid.ts
 * 설명: 화면 해상도에 맞춰 100mm 간격의 보조 격자를 합성하는 바닥 도형
 * 작성자: 이희원
 * 작성일자: 2026-11-24
 */
import * as THREE from 'three'

/**
 * 큰 격자 사이를 100mm 간격으로 나누는 보조 격자 생성
 * 큰 격자와 겹치는 선을 제외하고 화면에서 분리하기 어려운 먼 선을 점진적으로 제거
 * @param size 격자가 덮는 바닥 가로 및 세로 길이 미터 단위
 * @param majorStep 큰 격자의 간격 미터 단위
 * @param color 큰 격자와 공유하는 테마 색상 참조
 * @returns 바닥과 큰 격자 사이에 합성할 보조 격자 도형
 */
export const createMinorGrid = (size: number, majorStep: number, color: THREE.Color) => {
  const stepMeters = 0.1
  const material = new THREE.ShaderMaterial({
    uniforms: {
      stepMeters: { value: stepMeters },
      cellsPerMajor: { value: majorStep / stepMeters },
      gridColor: { value: color },
    },
    vertexShader: `
      varying vec2 gridPosition;
      void main() {
        gridPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 gridPosition;
      uniform float stepMeters;
      uniform float cellsPerMajor;
      uniform vec3 gridColor;

      void main() {
        vec2 cell = gridPosition / stepMeters;
        vec2 footprint = max(fwidth(cell), vec2(0.00001));
        vec2 nearestLine = floor(cell + 0.5);
        vec2 pixelDistance = abs(cell - nearestLine) / footprint;
        vec2 coverage = 1.0 - smoothstep(vec2(0.1), vec2(0.9), pixelDistance);
        vec2 visibleSpacing = 1.0 - smoothstep(vec2(0.18), vec2(0.42), footprint);
        vec2 betweenMajorLines = step(vec2(0.5), mod(nearestLine, cellsPerMajor));
        vec2 lines = coverage * visibleSpacing * betweenMajorLines;
        float alpha = 0.3 * max(lines.x, lines.y);
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(gridColor, alpha);
        #include <colorspace_fragment>
      }
    `,
    // 바닥과 지도 객체 사이의 그리기 순서를 유지하면서 선의 투명도만 합성
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  mesh.name = 'minor-grid'
  return mesh
}
