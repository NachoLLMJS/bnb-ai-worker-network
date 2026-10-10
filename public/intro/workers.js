import * as THREE from 'three';

// Small block-built maintenance crew. Visual ambience only: not provider telemetry.
export function createMaintenanceCrew(parent, reducedMotion = false) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const rigRoot = new THREE.Group();
  const batches = new Map();
  const colors = { skin: 0xe1b58d, boots: 0x26353e, suit: 0x487781, vest: 0xd8a83e,
    helmet: 0xf2c754, eyes: 0x172833, stripe: 0xe8e1bd, screen: 0xaadcb9, tablet: 0x354951 };
  function block(node, xyz, size, color) {
    const part = new THREE.Object3D();
    part.position.set(...xyz); part.scale.set(...size); node.add(part);
    if (!batches.has(color)) batches.set(color, []);
    batches.get(color).push(part);
    return part;
  }
  function limb(body, x, y, color, arm = false) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); body.add(pivot);
    block(pivot, [0, -.28, 0], [arm ? .27 : .33, .58, .34], color);
    block(pivot, [0, -.59, arm ? .02 : .10], [arm ? .27 : .35, .18, arm ? .34 : .51], arm ? colors.skin : colors.boots);
    return pivot;
  }
  const crew = [];
  for (let i = 0; i < 20; i++) {
    {
      const row = Math.floor((i % 10) / 2) % 4, shift = i % 2;
      const rackX = [-12.6, -4.2, 4.2, 12.6][row];
      const base = new THREE.Group(); rigRoot.add(base);
      const body = new THREE.Group(); base.add(body);
      const accent = i % 3 === 0 ? 0xf2c754 : i % 3 === 1 ? 0x95bea0 : 0xe7a176;
      block(body, [0, 1.14, 0], [.80, .79, .47], colors.suit);
      block(body, [0, 1.13, .25], [.73, .69, .06], accent);
      block(body, [0, .93, .295], [.73, .085, .025], colors.stripe);
      for (const x of [-.25, .25]) block(body, [x, 1.29, .295], [.075, .34, .025], colors.stripe);
      block(body, [0, .79, 0], [.83, .11, .50], colors.boots);
      block(body, [.40, .78, .10], [.16, .21, .23], colors.tablet);
      block(body, [0, 1.1, -.35], [.55, .57, .22], colors.tablet);
      const head = new THREE.Group(); head.position.y = 1.87; body.add(head);
      block(head, [0, 0, 0], [.69, .63, .61], colors.skin);
      block(head, [0, .31, -.02], [.80, .20, .74], accent);
      block(head, [0, .20, .09], [.91, .075, .89], accent);
      block(head, [0, .425, -.02], [.14, .04, .69], colors.stripe);
      for (const x of [-.17, .17]) {
        block(head, [x, .0, .311], [.085, .10, .022], colors.eyes);
        block(head, [x, -.12, .313], [.12, .045, .025], 0xc88775);
      }
      block(head, [0, -.13, .324], [.10, .035, .025], colors.eyes);
      block(head, [.375, .02, 0], [.09, .25, .25], colors.tablet);
      const legs = [limb(body, -.22, .72, colors.suit), limb(body, .22, .72, colors.suit)];
      const arms = [limb(body, -.56, 1.46, colors.suit, true), limb(body, .56, 1.46, colors.suit, true)];
      // A handheld diagnostic terminal in one hand, a spanner in the other.
      const terminal = new THREE.Group(); terminal.position.set(0, -.59, .18); arms[0].add(terminal);
      block(terminal, [0, 0, 0], [.38, .42, .085], colors.tablet);
      block(terminal, [0, 0, .05], [.29, .29, .025], colors.screen);
      for (let l = 0; l < 3; l++) block(terminal, [-.04, .07 - l * .065, .066], [.15, .019, .01], colors.suit);
      block(arms[1], [0, -.66, .20], [.075, .39, .07], 0x9eacb3);
      for (const x of [-.065, .065]) block(arms[1], [x, -.43, .20], [.065, .13, .07], 0x9eacb3);
      // The first ten walk the near and middle aisle stretches, the next ten the stretches between them.
      const z = i < 10 ? (shift === 0 ? -3.64 : -25.48) : (shift === 0 ? -14.56 : -36.4);
      const reach = i >= 10 && shift === 1 ? 3.64 : 7.28;
      // Each technician keeps to a separate stretch of an aisle.
      const points = i >= 18 ? [
        {x:i===18?-21:-1,z:4.2,wait:3},
        {x:i===18?-13:7,z:4.2,wait:2},
        {x:i===18?-13:7,z:2.6,wait:5,work:true},
        {x:i===18?-21:-1,z:2.6,wait:1},
      ] : i === 8 || i === 9 ? [
        {x:i===8?-5:9,z:-44.7,wait:2},
        {x:i===8?3:17,z:-44.7,wait:4},
        {x:i===8?3:17,z:-42.8,wait:5,work:true},
        {x:i===8?-5:9,z:-42.8,wait:1},
      ] : [
        {x:rackX+4.25,z:z+2.0,wait:1},
        {x:rackX+4.25,z:z-reach,wait:0},
        {x:rackX+3.1,z:z-reach,wait:6,work:true},
        {x:rackX+4.25,z:z-reach,wait:0},
        {x:rackX+4.25,z,wait:0},
        {x:rackX+3.1,z,wait:7,work:true},
        {x:rackX+4.25,z,wait:0},
      ];
      let duration = 0;
      const segments = points.map((point, index) => {
        const next = points[(index+1)%points.length];
        const travel = Math.hypot(next.x-point.x,next.z-point.z)/.92;
        const segment = {point,next,start:duration,wait:point.wait,travel};
        duration += point.wait+travel;
        return segment;
      });
      crew.push({base,body,head,legs,arms,segments,duration,offset:i*6.8,phase:i*.9});
    }
  }
  const meshes = [];
  for (const [color, parts] of batches) {
    const mat = new THREE.MeshStandardMaterial({color,roughness:.86,metalness:.02});
    const mesh = new THREE.InstancedMesh(geometry,mat,parts.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled=false; mesh.castShadow=true; mesh.receiveShadow=true;
    parent.add(mesh); meshes.push({mesh,parts});
  }
  function update(time) {
    const t = reducedMotion ? 0 : time;
    for (const worker of crew) {
      const phase = (t+worker.offset)%worker.duration;
      const segment = worker.segments.find(s=>phase<s.start+s.wait+s.travel) ?? worker.segments[0];
      const local = phase-segment.start;
      const walking = local>=segment.wait;
      const f = walking ? Math.min(1,(local-segment.wait)/segment.travel) : 0;
      const {point,next} = segment;
      const stride = Math.sin(t*7+worker.phase);
      worker.base.position.set(THREE.MathUtils.lerp(point.x,next.x,f),-4.22,THREE.MathUtils.lerp(point.z,next.z,f));
      worker.base.rotation.y = walking ? Math.atan2(next.x-point.x,next.z-point.z) : point.work ? -Math.PI/2 : Math.atan2(next.x-point.x,next.z-point.z);
      worker.body.position.y = walking ? Math.abs(stride)*.065 : 0;
      worker.legs[0].rotation.x = walking ? stride*.43 : 0;
      worker.legs[1].rotation.x = walking ? -stride*.43 : 0;
      worker.arms[0].rotation.x = walking ? -stride*.23-.2 : -.90;
      worker.arms[1].rotation.x = walking ? stride*.30 : point.work ? -1.1+Math.sin(t*4+worker.phase)*.17 : -.2;
      worker.arms[1].rotation.z = point.work&&!walking ? -.16 : 0;
      worker.head.rotation.x = walking ? 0 : .12+Math.sin(t*1.5+worker.phase)*.04;
      worker.head.rotation.y = walking ? Math.sin(t*.7+worker.phase)*.09 : -.07;
    }
    rigRoot.updateMatrixWorld(true);
    for (const {mesh,parts} of meshes) {
      parts.forEach((part,index)=>mesh.setMatrixAt(index,part.matrixWorld));
      mesh.instanceMatrix.needsUpdate=true;
    }
  }
  update(0);
  return {update,count:crew.length};
}
