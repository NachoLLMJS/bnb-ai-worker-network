import {initServicePanel} from './marketplace-panel.js?v=api-market-4';
import { createMaintenanceCrew } from './workers.js';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const loaderMode=new URLSearchParams(location.search).get('loader')==='1';
if(loaderMode)document.documentElement.classList.add('loader-mode');
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer;
try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'}); }
catch(e){ $('#fallback').hidden=false; $('#loading').remove(); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.setClearColor(0x171b1e);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('#viewport').appendChild(renderer.domElement);
const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x171b1e,.025);
const pmrem=new THREE.PMREMGenerator(renderer);
const room=new RoomEnvironment();
const environment=pmrem.fromScene(room,.055);scene.environment=environment.texture;scene.environmentIntensity=.62;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.05,160);

const ambient=new THREE.HemisphereLight(0xe4e6e2,0x17191b,.85);scene.add(ambient);
const key=new THREE.DirectionalLight(0xfff9e9,3.1);key.position.set(-4,12,7);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-16;key.shadow.camera.right=16;key.shadow.camera.top=14;key.shadow.camera.bottom=-14;key.shadow.camera.near=.5;key.shadow.camera.far=60;key.shadow.bias=-.00015;key.shadow.normalBias=.04;scene.add(key);
const rim=new THREE.DirectionalLight(0xd0dae0,1.6);rim.position.set(-9,4,-6);scene.add(rim);
const fill=new THREE.DirectionalLight(0xffe4c4,.6);fill.position.set(7,1,4);scene.add(fill);
const glow=new THREE.PointLight(0xb8f593,2.5,8,2);glow.position.set(0,2,4);scene.add(glow);
const geometry={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,16),sphere:new THREE.SphereGeometry(1,32,20),torus:new THREE.TorusGeometry(1,.055,10,40)};
const palette={dark:0x171c24,metal:0x414b58,edge:0x88929e,black:0x05090e,pcb:0x102925,copper:0x9b7648,gold:0xbca673,light:0xbdc8d2,green:0xb9e890,die:0x394756,blue:0x7fa1bf};
geometry.rounded=new RoundedBoxGeometry(1,1,1,2,.035);
const blade=new THREE.Shape();blade.moveTo(.055,0);blade.bezierCurveTo(.09,.025,.18,.045,.21,.12);blade.bezierCurveTo(.25,.09,.24,.005,.17,-.045);blade.bezierCurveTo(.11,-.06,.065,-.03,.055,0);
geometry.blade=new THREE.ExtrudeGeometry(blade,{depth:.014,bevelEnabled:false,curveSegments:9});
const metalCanvas=document.createElement('canvas');metalCanvas.width=256;metalCanvas.height=256;const mc=metalCanvas.getContext('2d');mc.fillStyle='#aaa';mc.fillRect(0,0,256,256);for(let y=0;y<256;y++){const v=145+Math.floor(Math.sin(y*81.317)*23);mc.fillStyle=`rgb(${v},${v},${v})`;mc.fillRect(0,y,256,1);}const brushed=new THREE.CanvasTexture(metalCanvas);brushed.wrapS=brushed.wrapT=THREE.RepeatWrapping;brushed.repeat.set(3,5);brushed.anisotropy=renderer.capabilities.getMaxAnisotropy();
let seed=43;function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
function builder(group){
 const batches=new Map();let bound=null;
 function put(kind,color,pos,scale,rotation=[0,0,0],emit=0){
  if(kind==='box'&&scale[0]>.4&&scale[1]>.12&&scale[2]>.3)kind='rounded';
  const key=kind+color+emit;
  if(!batches.has(key)){
   const mat=new THREE.MeshStandardMaterial({color,roughness:emit?.45:color===palette.black?.65:color===palette.pcb?.7:.36,metalness:emit?.1:color===palette.pcb?.2:.8,emissive:emit?color:0,emissiveIntensity:emit});
   if([palette.metal,palette.edge,palette.light].includes(color)){mat.roughnessMap=brushed;mat.roughness=.75;}
   batches.set(key,{kind,mat,items:[]});
  }
  batches.get(key).items.push({pos,scale,rotation,bound});
 }
 function finish(){const obj=new THREE.Object3D(); for(const b of batches.values()){
  const mesh=new THREE.InstancedMesh(geometry[b.kind],b.mat,b.items.length);
  b.items.forEach((it,i)=>{obj.position.set(...it.pos);obj.scale.set(...it.scale);obj.rotation.set(...it.rotation);obj.updateMatrix();const matrix=obj.matrix.clone();if(it.bound){it.bound.updateMatrix();matrix.premultiply(it.bound.matrix);(it.bound.userData.instances??=[]).push({mesh,index:i,local:obj.matrix.clone()});}mesh.setMatrixAt(i,matrix)});
  mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }}
 return {bind:g=>{bound=g;},blade:(x,y,z,a=0)=>put('blade',0x26303d,[x,y,z],[1,1,1],[0,0,a],0),box:(x,y,z,w,h,d,c=palette.metal,e=0,r=[0,0,0])=>put('box',c,[x,y,z],[w,h,d],r,e),cyl:(x,y,z,r,h,c=palette.metal,rot=[0,0,0],e=0)=>put('cylinder',c,[x,y,z],[r,h,r],rot,e),sphere:(x,y,z,r,c=palette.light,e=0)=>put('sphere',c,[x,y,z],[r,r,r],[0,0,0],e),torus:(x,y,z,r,c=palette.metal,rot=[0,0,0],e=0)=>put('torus',c,[x,y,z],[r,r,r],rot,e),finish};
}
function textPlate(group,text,x,y,z,w=1,h=.2,color='#b1b8ad',bg='#141c18',ry=0){
 if(loaderMode){const mesh=new THREE.Object3D();group.add(mesh);return mesh;}
 const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=color;ctx.font='36px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 const m=new THREE.MeshBasicMaterial({map:tex});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);mesh.position.set(x,y,z);mesh.rotation.y=ry;group.add(mesh);return mesh;
}
function tube(group,points,color,r=.028,emit=0){const curve=new THREE.CatmullRomCurve3(points.map(v=>new THREE.Vector3(...v)));const m=new THREE.MeshStandardMaterial({color,roughness:.6,metalness:.3,emissive:color,emissiveIntensity:emit});const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,24,r,6,false),m);group.add(mesh);return mesh;}
const groups=Array.from({length:5},()=>new THREE.Group());groups.forEach(g=>{scene.add(g);g.visible=false;});
const clickable=[],rackFrames=[];
// 01 / A physical machine hall. Racks, sleds, perforated fronts, cable looms.
const floor=groups[0],b=builder(floor);



const fanCenters=[],rackBuilder=builder(floor);
function rack(x,z,index,active=false,yaw=0){
 const frame=new THREE.Group();frame.position.set(x,0,z);frame.rotation.y=yaw;floor.add(frame);rackFrames.push(frame);const b=rackBuilder;b.bind(frame);x=0;z=0;
 const w=3.5,h=8.3,depth=3;
 b.box(x,0,z,w,h,depth,0x222529);
 // Steel roof, ribbed end panels and rear ventilation.
 b.box(0,4.19,0,3.54,.12,3.04,0x474c50);
 for(let z=-1.3;z<=1.3;z+=.26){b.box(-1.76,0,z,.032,7.95,.075,0x101215);b.box(1.76,0,z,.032,7.95,.075,0x101215);}
 for(let y=-3.7;y<3.6;y+=.25)b.box(0,y,-1.516,3.12,.12,.025,0x121518);
 for(const x of [-1.38,1.38])for(const z of [-1.1,1.1])b.cyl(x,4.263,z,.065,.024,0x292d30);
 b.box(x,0,z+1.52,3.2,7.94,.12,palette.black);
 for(const s of [-1,1]){b.box(x+s*1.72,0,z+1.57,.12,h,.18,0x545f6b);b.box(x+s*1.5,0,z+1.63,.075,h-.25,.08,palette.metal);b.box(x+s*1.75,0,z-.9,.10,h,.10,palette.metal);}
 b.box(x,4.1,z+1.6,3.5,.15,.15,0x545f6b);b.box(x,-4.1,z+1.6,3.5,.15,.15,0x545f6b);
 for(let y=-3.8;y<4;y+=.27){b.box(x-1.51,y,z+1.69,.035,.09,.015,palette.black);b.box(x+1.51,y,z+1.69,.035,.09,.015,palette.black);}
 for(let s=0;s<(active?0:10);s++){
  const y=-3.45+s*.73,extended=active&&s===6;
  const front=z+1.7+(extended?1.5:0);
  b.box(x,y,extended?z+1.9:z+1.50,2.85,.59,extended?2.6:.25,extended?palette.metal:0x28312f);
  b.box(x,y,front,2.79,.52,.1,0x1d2724);
  for(let f=0;f<5;f++){
   let fx=x-1.09+f*.52;
   b.cyl(fx,y,front+.065,.207,.025,palette.black,[Math.PI/2,0,0]);
   b.torus(fx,y,front+.09,.212,0x343f4b);
   b.cyl(fx,y,front+.09,.06,.03,palette.metal,[Math.PI/2,0,0]);
   for(let q=0;q<5;q++){const angle=q*Math.PI*2/5;b.blade(fx,y,front+.083,angle);}
   if(extended)fanCenters.push([fx,y,front+.10]);
  }
  b.box(x+1.25,y+.13,front+.08,.035,.055,.025,active?palette.green:0x72806b,active?.9:.08);
  b.box(x+1.25,y-.02,front+.08,.035,.055,.025,0x5b7563,.2);
  for(const side of [-1,1])b.box(x+side*1.42,y,front+.12,.1,.40,.16,palette.edge);
  if(extended){
   b.box(x,y+.305,z+1.6,2.64,.045,2.6,palette.pcb);
   for(let a=-1;a<=1;a++)for(let c=0;c<2;c++){
    b.box(x+a*.8,y+.44,z+.65+c*.95,.62,.21,.67,palette.dark);
    for(let fin=0;fin<11;fin++)b.box(x+a*.8-.27+fin*.055,y+.60,z+.65+c*.95,.025,.22,.6,palette.edge);
   }
   b.box(x,y-.29,front+.12,2.65,.025,.025,palette.green,1.5);
   tube(floor,[[x+1.1,y+.3,z+.6],[x+1.65,y+.85,z+1.3],[x+1.76,y+.3,z+2.8],[x+1.3,y-.4,z+3]],0x849e69,.035);
  }
 }
 textPlate(frame,`S / ${String(index).padStart(2,'0')}`,x,3.85,z+1.72,2.2,.19,active?'#c6e79e':'#85988a');

 const target=new THREE.Mesh(new THREE.BoxGeometry(3.55,8.3,3.1),new THREE.MeshBasicMaterial({visible:false}));target.position.set(x,0,z);target.userData.rack=index;frame.add(target);clickable.push(target);
}
const rackLayout=[];
const rowCenters=[-12.6,-4.2,4.2,12.6],rackCountPerRow=12;
for(let bank=0;bank<rowCenters.length;bank++)for(let column=0;column<rackCountPerRow;column++){
 const index=bank*rackCountPerRow+column,x=rowCenters[bank],z=-column*3.64,yaw=Math.PI/2;
 rackLayout.push({index,x,z,yaw});rack(x,z,index+1,true,yaw);
}
rackBuilder.finish();
// Provider roofs indicate active API liquidity, nearest the camera first;
// routes with live marketplace activity pulse.
const rackLights=new THREE.InstancedMesh(new THREE.BoxGeometry(3.3,.03,2.8),new THREE.MeshBasicMaterial({color:0xffffff}),rackLayout.length);
const lightOrder=[];for(let column=rackCountPerRow-1;column>=0;column--)for(let bank=0;bank<rowCenters.length;bank++)lightOrder.push(bank*rackCountPerRow+column);
{const place=new THREE.Object3D(),offset=new THREE.Matrix4().makeTranslation(0,4.27,0);
 lightOrder.forEach((rackIndex,i)=>{const r=rackLayout[rackIndex];place.position.set(r.x,0,r.z);place.rotation.set(0,r.yaw,0);place.updateMatrix();rackLights.setMatrixAt(i,place.matrix.clone().multiply(offset));rackLights.setColorAt(i,new THREE.Color(0x474c50));});}
floor.add(rackLights);
const vaultRoom={lit:0,running:0},litColor=new THREE.Color(0x3d8fe0),offColor=new THREE.Color(0x474c50),hotColor=new THREE.Color(0xdff0ff),mixed=new THREE.Color();
function paintRacks(time=0){
 const pulse=.5+.5*Math.sin(time/260);
 for(let i=0;i<rackLayout.length;i++)rackLights.setColorAt(i,i<vaultRoom.running?mixed.copy(litColor).lerp(hotColor,pulse):i<vaultRoom.lit?litColor:offColor);
 rackLights.instanceColor.needsUpdate=true;
}
(function pulseRacks(time){requestAnimationFrame(pulseRacks);if(vaultRoom.running)paintRacks(time);})(0);
async function loadRoom(){
 try{
  const r=await (await fetch('/api/room',{cache:'no-store'})).json(),capacity=Number(BigInt(r.principal)/10000000n)/100;
  vaultRoom.lit=Math.min(rackLayout.length,Math.ceil(capacity));vaultRoom.running=Math.min(vaultRoom.lit||rackLayout.length,r.running);paintRacks();
  $('#room-total').textContent='';
 }catch{}
}
if(!loaderMode){loadRoom();setInterval(loadRoom,60000);}
// Open-roof industrial hall: raised tiles, service aisles and overhead utilities.
b.box(0,-4.46,-19.8,48,.35,62,0x414649);
for(let x=-24;x<=24;x+=1.3)b.box(x,-4.275,-19.8,.019,.013,62,0x181b1e);
for(let z=-50.8;z<=11.2;z+=1.3)b.box(0,-4.272,z,48,.013,.019,0x181b1e);
for(const x of [-17.5,-8.4,0,8.4,17.5]){
 b.box(x,-4.26,-19.8,2.7,.023,47,0x1b1e20);
 for(const side of [-1,1])b.box(x+side*1.37,-4.24,-19.8,.028,.02,47,0x72736b);
 for(let z=-42;z<4;z+=1.3)for(let slit=0;slit<7;slit++)b.box(x-.85+slit*.28,-4.239,z,.11,.009,.7,0x111416);
}
const trayYellow=0xefc52e,pipeRed=0xa64642;
for(const x of rowCenters){
 // U-section fibre trays and two supply/return lines run the full row.
 b.box(x-.25,6.1,-20,1.03,.13,46,trayYellow);
 for(const side of [-1,1])b.box(x-.25+side*.52,6.26,-20,.06,.36,46,trayYellow);
 for(let wire=0;wire<5;wire++)b.cyl(x-.55+wire*.15,6.19,-20,.043,45,0x292a25,[Math.PI/2,0,0]);
 b.cyl(x+1.10,6.70,-20,.10,47,pipeRed,[Math.PI/2,0,0]);
 for(let pipe=0;pipe<3;pipe++)b.cyl(x-1.04-pipe*.23,5.52,-20,.105,46,0x34383a,[Math.PI/2,0,0]);
 for(let z=1.5;z>-42;z-=3.64){
  for(const side of [-1,1])b.box(x-.25+side*.39,5.15,z,.047,1.85,.047,trayYellow);
  b.box(x-.5,5.39,z,3.05,.09,.14,0x777979);
  b.box(x+1.10,5.35,z,.05,2.66,.05,0x5e6061);
  b.torus(x+1.10,6.7,z,.126,0x737374);
 }
}
// Architectural enclosure. Near walls are cut away for the overview camera.
const wall=0x626a6d,trim=0x30383d,concrete=0x444c50;
b.box(-24,4.0,-19.8,.45,16.5,62,wall);
b.box(0,4.0,11.2,48,16.5,.45,wall);
for(let z=-50;z<12;z+=3.6){
 b.box(-23.75,3.8,z,.025,16,.045,0x323b40);
 b.box(-23.70,-2.6,z,.04,2.8,3.53,0x414a50);
}
for(let x=-23;x<24;x+=3.6){
 b.box(x,3.8,10.95,.045,16,.025,0x323b40);
 b.box(x,-2.6,10.90,3.53,2.8,.04,0x414a50);
}
// Dark crash rails and skirting give the raised floor a continuous room edge.
b.box(-23.65,-3.75,-19.8,.16,.45,62,trim);
b.box(0,-3.75,10.8,48,.45,.16,trim);
b.box(-23.6,-1.4,-19.8,.20,.18,61,0x151c21);
b.box(0,-1.4,10.75,47,.18,.20,0x151c21);
// A partially exposed ceiling with structural beams and suspended strip lights.
for(const x of [-23.3,23.3])for(const z of [10,-5,-20,-35,-50]){
 b.box(x,3.5,z,.65,15.6,.65,concrete);
 b.box(x,-4.15,z,1,.20,1,0x6b7477);
}
b.box(-21.7,12,-19.8,4.6,.3,62,0x30383f);
b.box(0,12,8.6,48,.3,5,0x30383f);
for(const z of [8,-7,-22,-37,-50]){
 b.box(0,11.65,z,48,.42,.28,0x434d54);
 b.box(0,11.91,z,48,.07,.65,0x566068);
 b.box(0,11.42,z,48,.07,.65,0x566068);
}
for(const x of [-20,20]){
 b.box(x,9.8,-20,1.1,1.05,57,0x7c8486);
 for(let z=-47;z<9;z+=2.7){b.box(x,9.8,z,1.16,1.1,.06,0x454f55);}
 for(let z=-43;z<7;z+=7.5){
  b.box(x+(x<0?1.1:-1.1),9.14,z,.2,.12,5.9,0x30383c);
  b.box(x+(x<0?1.1:-1.1),9.065,z,.12,.025,5.7,0xdfebea,2.2);
 }
}
// Cooling cabinets against the service wall, with coil fins and condenser fans.
for(let z=-43;z<6;z+=7){
 b.box(-21.8,-.65,z,2.7,7.1,4.4,0x505b62);
 b.box(-20.40,-.45,z,.08,6.5,4.1,0x192329);
 for(let fin=0;fin<22;fin++)b.box(-20.32,-3.3+fin*.255,z,.06,.09,3.85,0x788388);
 b.box(-20.27,2.12,z,.09,.32,1.3,0x101619);
 b.box(-20.2,2.12,z+.38,.03,.09,.17,0xa8d997,.8);
 for(const dz of [-1.05,1.05]){
  b.cyl(-21.8,2.94,z+dz,.73,.05,0x172025);
  b.torus(-21.8,2.99,z+dz,.68,0x6d797e,[Math.PI/2,0,0]);
  b.cyl(-21.8,3.02,z+dz,.16,.06,0x515d63);
 }
}
// Double service door and an observation window on the far wall.
b.box(10,-.45,10.62,5.5,7.6,.30,0x252f35);
for(const side of [-1,1]){
 b.box(10+side*1.34,-.46,10.42,2.56,7.22,.10,0x536269);
 b.box(10+side*1.34,1.05,10.34,1.4,2.2,.035,0x152a33);
 b.box(10+side*.30,-.8,10.29,.09,1.0,.12,0xabb5b7);
 b.box(10+side*2.82,-.45,10.36,.15,7.75,.18,0xa5afb0);
}
b.box(10,3.46,10.36,5.77,.15,.18,0xa5afb0);
b.box(10,4.1,10.4,1.5,.47,.13,0x436c51);
textPlate(floor,'EXIT',10,4.1,10.31,1.3,.24,'#e3f0e2','#436c51',Math.PI);
b.box(-4,1.1,10.60,10.7,4.5,.3,trim);
b.box(-4,1.1,10.4,10.25,4.06,.03,0x21323c);
for(const x of [-7.4,-4,-.6])b.box(x,1.1,10.30,.07,4.15,.08,0x91a1a6);
b.box(-4,3.3,10.24,10.9,.08,.15,0xaebbbc);
for(const x of [-12.6,-4.2,4.2,12.6]){
 b.box(x,9.02,6.2,3.3,.10,.3,0x313d43);
 b.box(x,8.95,6.2,3.15,.025,.18,0xd8e9ec,2);
}
b.finish();
const roof=new THREE.Group();floor.add(roof);
const hallLight=new THREE.HemisphereLight(0xe0e2df,0x272724,.55);scene.add(hallLight);
// 02 / Accelerator carrier. All detail is geometry, not a background image.
const machine=groups[1],mb=builder(machine),chipAssembly=new THREE.Group();machine.add(chipAssembly);
mb.box(0,-.40,0,10.8,.22,7.2,palette.metal);mb.box(0,-.25,0,10.1,.12,6.7,palette.pcb);
mb.box(0,-.52,0,11,.09,7.45,palette.dark);
for(let i=0;i<4;i++)for(let j=0;j<3;j++){
 let x=-4.6+i*3.06,z=-2.8+j*2.8;mb.cyl(x,-.13,z,.12,.07,palette.copper);mb.cyl(x,-.08,z,.052,.025,palette.dark);
}
for(let x=-4.5;x<=4.5;x+=.22){mb.box(x,-.168,0,.018,.006,6,palette.copper);}
for(let z=-3;z<=3;z+=.23){mb.box(0,-.161,z,9.3,.006,.012,0x49634b);}
for(let side of [-1,1])for(let n=0;n<18;n++){
 let z=-2.6+n*.3;mb.box(side*4.15,-.02,z,.48,.25,.18,palette.black);
 mb.box(side*4.45,-.04,z,.07,.21,.14,palette.metal);mb.box(side*3.85,-.04,z,.07,.21,.14,palette.metal);
}
for(let n=0;n<35;n++){mb.box(-4.2+n*.25,-.23,3.43,.16,.07,.28,palette.gold);}
for(let i=0;i<70;i++){let x=(rand()-.5)*9,z=(rand()-.5)*5.8;if(Math.abs(x)<3.5&&Math.abs(z)<2.35)continue;mb.box(x,-.11,z,.10,.15,.06,palette.light);}
const cb=builder(chipAssembly);
cb.box(0,0,0,6.7,.12,4.9,palette.dark);cb.box(0,.09,0,4,.08,3.7,palette.gold);cb.box(0,.16,0,3.62,.09,3.35,0x334345);
for(let side of [-1,1])for(let z=-1.6;z<=1.6;z+=1.05){
 cb.box(side*2.6,.12,z,.95,.22,.85,palette.black);cb.box(side*2.6,.244,z,.83,.025,.73,palette.metal);
 for(let k=0;k<7;k++)cb.box(side*2.6-.35+k*.115,.26,z,.02,.018,.62,0x7d8981);
}
for(let ix=0;ix<10;ix++)for(let iz=0;iz<9;iz++){
 const x=-1.56+ix*.347,z=-1.43+iz*.352;
 cb.box(x,.223,z,.31,.035,.31,(ix<5)?0x718b80:0x8b8970);
 for(let j=0;j<4;j++)cb.box(x-.1+j*.067,.247,z,.019,.01,.27,j%2?palette.copper:palette.light);
}
cb.box(0,.253,0,.035,.018,3.35,palette.green,.7);
cb.finish();mb.finish();
const heatsink=new THREE.Group(),hb=builder(heatsink);machine.add(heatsink);
hb.box(0,.66,0,6.8,.12,5,0x637269);
for(let i=0;i<44;i++)hb.box(-3.25+i*.15,1,0,.045,.62,4.8,palette.edge);
hb.finish();heatsink.visible=false;
const machineLabel=textPlate(machine,'INPUT    /    API ROUTER 08',0,-.03,3.18,3,.24,'#bfcca9');machineLabel.rotation.x=-Math.PI/2;
// 03 / Silicon die: nested parallel compute arrays and dense memory cells.
const silicon=groups[2],sb=builder(silicon);
sb.box(0,-.34,0,12,.55,10,palette.dark);sb.box(0,-.04,0,11.8,.055,9.8,palette.gold);sb.box(0,.02,0,11.55,.055,9.55,0x254036);
for(let i=0;i<12;i++)for(let j=0;j<8;j++){
 const x=-5.22+i*.95,z=-4.08+j*1.16;
 sb.box(x,.1,z,.83,.11,1.04,palette.dark);
 sb.box(x,.19,z,.76,.065,.97,(i===6&&j===4)?0xa7c384:0x5e746a);
 for(let k=0;k<7;k++)for(let q=0;q<6;q++)sb.box(x-.30+k*.10,.239,z-.39+q*.154,.065,.035,.12,(k+q)%3?palette.metal:palette.gold);
 for(const side of [-1,1])sb.box(x+side*.418,.20,z,.018,.012,1.02,palette.copper);
}
for(let i=0;i<12;i++){sb.box(-5.23+i*.95,.24,0,.013,.01,9.6,palette.green,.35);}
sb.box(.48,.30,.55,.89,.025,1.09,palette.green,.4);sb.box(.48,.325,.55,.80,.015,1.00,palette.dark);
sb.finish();
// 04 / Stylized gates and interconnects, a microscopic landscape.
const logic=groups[3],lb=builder(logic);
lb.box(0,-.55,0,15,.8,13,0x626b62);lb.box(0,-.12,0,14.9,.08,12.9,palette.dark);
for(let row=0;row<25;row++)for(let col=0;col<26;col++){
 const x=-7+col*.55,z=-5.9+row*.48;
 lb.box(x,.05,z,.35,.3,.26,0x65796e);
 lb.box(x,.25,z,.085,.20,.40,palette.light);
 lb.box(x-.115,.15,z,.06,.27,.20,palette.gold);lb.box(x+.115,.15,z,.06,.27,.20,palette.gold);
}
for(let i=0;i<25;i++){lb.box(0,.40,-5.9+i*.48,14,.034,.035,i%4===0?palette.green:palette.copper,i%4===0?.35:0);}
for(let i=0;i<26;i++)lb.box(-7+i*.55,.53,0,.035,.035,12,palette.edge);
lb.finish();
// 05 / An illustrative crystal lattice with nearest-neighbour bonds.
const atoms=groups[4],ab=builder(atoms),spacing=1.15,atomsList=[];
for(let x=-5;x<=5;x++)for(let y=-2;y<=2;y++)for(let z=-4;z<=4;z++){
 if((x+y+z)%2!==0)continue;const p=new THREE.Vector3(x*spacing,y*spacing,z*spacing);atomsList.push(p);
 const active=Math.abs(x)<=1&&Math.abs(y)<=1&&Math.abs(z)<=1;
 ab.sphere(p.x,p.y,p.z,active?.21:.17,active?palette.green:0x8a9990,active?.38:0);
}
ab.finish();
const bonds=new THREE.BufferGeometry(),verts=[];
for(let i=0;i<atomsList.length;i++)for(let j=i+1;j<atomsList.length;j++){
 const a=atomsList[i],c=atomsList[j],dist=a.distanceTo(c);if(dist<spacing*1.45){verts.push(a.x,a.y,a.z,c.x,c.y,c.z);}
}
bonds.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));atoms.add(new THREE.LineSegments(bonds,new THREE.LineBasicMaterial({color:0x6c8874,transparent:true,opacity:.48})));
const orbital=new THREE.Group();atoms.add(orbital);const ob=builder(orbital);ob.finish();
// Small work packets move across the selected board and through the lattice.
const particles=[];for(let i=0;i<22;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.025,5,4),new THREE.MeshBasicMaterial({color:0xd4ffac}));m.userData.offset=rand();groups[i<10?1:3].add(m);particles.push(m);}
// Eight independently removable accelerator modules in every rack.
const gpuModules=[],gpuTargets=[],gb=builder(floor);
for(const rackData of rackLayout)for(let slot=0;slot<8;slot++){
 const n=rackData.index*8+slot;
 const g=new THREE.Group();floor.add(g);g.rotation.y=rackData.yaw;g.position.set(rackData.x+Math.sin(rackData.yaw)*.20,-3.30+slot*.91,rackData.z+Math.cos(rackData.yaw)*.20);
 g.userData.rack=rackData.index;g.userData.slot=slot;g.userData.homeZ=g.position.z;g.userData.homeX=g.position.x;
 gb.bind(g);
 gb.box(0,0,0,2.82,.48,2.75,0x303c36);
 gb.box(0,.253,0,2.67,.035,2.59,palette.pcb);
 gb.box(0,-.255,0,2.91,.035,2.8,palette.edge);
 gb.box(0,0,1.425,2.82,.56,.12,0x53595d);
 for(const side of [-1,1]){
  gb.box(side*1.40,0,1.51,.085,.45,.14,palette.edge);
  gb.cyl(side*.65,0,1.505,.22,.035,palette.black,[Math.PI/2,0,0]);
  gb.torus(side*.65,0,1.53,.225,0x414d5b);
  gb.cyl(side*.65,0,1.54,.067,.05,palette.metal,[Math.PI/2,0,0]);
  for(let q=0;q<7;q++){const a=q*Math.PI*2/7;gb.blade(side*.65,0,1.533,a);}
  for(let h=0;h<12;h++)gb.box(side*1.15,.31,-1.05+h*.18,.2,.08,.085,palette.black);
 }
 gb.box(0,.31,-.12,1.12,.08,1.1,palette.black);
 gb.box(0,.364,-.12,.88,.035,.85,palette.gold);
 gb.box(0,.39,-.12,.75,.03,.70,0x708d83);
 for(let a=0;a<7;a++)for(let c=0;c<6;c++)gb.box(-.30+a*.10,.408,-.40+c*.11,.07,.015,.075,(a+c)%2?palette.metal:palette.copper);
 for(const side of [-1,1])for(let z=-.8;z<=.8;z+=.5)gb.box(side*.81,.32,z,.29,.12,.33,palette.metal);
 for(let l=0;l<9;l++)gb.box(-1.17+l*.29,.277,-.1,.014,.01,2.3,0x9b9d66);
 gb.box(1.21,.11,1.506,.035,.05,.02,palette.green,.8);
 for(const x of [-1.32,1.32])for(const z of [-1.26,1.25]){gb.cyl(x,.298,z,.045,.023,palette.edge);gb.box(x,.314,z,.04,.006,.009,palette.black);}
 for(let vent=0;vent<20;vent++){gb.box(-1.23+vent*.13,-.15,1.50,.055,.038,.018,palette.black);}
 for(const side of [-1,1]){gb.box(side*1.47,-.1,-.07,.055,.13,2.83,palette.metal);gb.box(side*1.478,-.04,-.07,.025,.013,2.77,palette.light);}
 gb.box(1.13,.1,1.511,.016,.23,.014,palette.green,1.3);
 textPlate(g,'API '+String(slot+1).padStart(2,'0'),0,0,1.503,.63,.10,'#c2d4ad');
 const hit=new THREE.Mesh(new THREE.BoxGeometry(2.85,.70,2.95),new THREE.MeshBasicMaterial({visible:false}));hit.userData.gpu=n;g.add(hit);gpuTargets.push(hit);
 g.userData.homeY=g.position.y;g.userData.pull=0;gpuModules.push(g);
}
gb.finish();
const vectors=[[2.7,3.5,5.8],[8,10,10],[6,10,9],[5,6,9],[5,3.5,8]];
let selectedGPU=141,selectedRack=17,extracted=false,depth=loaderMode?-2:-1,targetDepth=loaderMode?-2:-1,activeStage=-1,elapsed=0,lastTime=0,tour=false,tourDirection=1,orbitX=0,orbitY=0,drag=null,dragged=false,exploded=false,explodeAmount=0,touched=false,loaderDone=false;
const smooth=x=>x*x*(3-2*x),blend=x=>loaderMode?clamp(x,0,1):smooth(clamp(x,0,1)),view=$('#viewport'),V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const absScales=[1,.25,.075,.004125,.000066];
const anchors=Array.from({length:5},()=>V()),worldTarget=V(),direction=V(),focusPosition=V(rackLayout[17].x,.1,rackLayout[17].z);
function placeWorld(){
 const mod=gpuModules[selectedGPU],yaw=rackLayout[selectedRack].yaw,axis=V(0,1,0);anchors[0].copy(focusPosition);
 anchors[1].copy(mod.position).add(V(0,.30,-.10).applyAxisAngle(axis,yaw));
 anchors[2].copy(anchors[1]).add(V(0,.24,0).applyAxisAngle(axis,yaw).multiplyScalar(absScales[1]));
 anchors[3].copy(anchors[2]).add(V(.48,.29,.55).applyAxisAngle(axis,yaw).multiplyScalar(absScales[2]));
 anchors[4].copy(anchors[3]).add(V(.15,.29,.10).applyAxisAngle(axis,yaw).multiplyScalar(absScales[3]));
 const i=clamp(Math.floor(depth),0,3),f=Math.max(0,depth-i),t=blend(f),unit=Math.exp(THREE.MathUtils.lerp(Math.log(absScales[i]),Math.log(absScales[i+1]),t));
 worldTarget.copy(anchors[i]).lerp(anchors[i+1],t);
 const va=new THREE.Vector3(...vectors[i]).applyAxisAngle(axis,yaw),vb=new THREE.Vector3(...vectors[i+1]).applyAxisAngle(axis,yaw);
 let dist=Math.exp(THREE.MathUtils.lerp(Math.log(va.length()*absScales[i]),Math.log(vb.length()*absScales[i+1]),t))/unit;
 direction.copy(va.normalize()).lerp(vb.normalize(),t).normalize();
 if(depth<0){
  const interiorTarget=V(0,0,-19),interiorVector=V(32,29,-32).multiplyScalar(innerWidth<600?1.3:1);
  if(depth>=-1){const roomT=blend(depth+1),near=new THREE.Vector3(...vectors[0]).applyAxisAngle(axis,yaw);worldTarget.copy(interiorTarget).lerp(anchors[0],roomT);dist=Math.exp(THREE.MathUtils.lerp(Math.log(interiorVector.length()),Math.log(near.length()),roomT));direction.copy(interiorVector.normalize()).lerp(near.normalize(),roomT).normalize();}
  else{const roomT=blend(depth+2),far=V(49,48,-57);worldTarget.set(0,0,-19).lerp(interiorTarget,roomT);dist=THREE.MathUtils.lerp(far.length()*Math.max(1,1/camera.aspect),interiorVector.length(),roomT);direction.copy(far.normalize()).lerp(interiorVector.normalize(),roomT).normalize();}
 }else if(innerWidth<600)dist*=THREE.MathUtils.lerp(1,1.12,Math.min(depth,1));
 scene.fog.density=depth<0?.003:.020;
 roof.visible=depth> -1.65&&depth<.75;
 if(!reduced)dist*=1+.10*Math.exp(-elapsed*.85);
 const az=Math.atan2(direction.x,direction.z)+orbitX+(reduced?0:Math.sin(elapsed*.08)*.015);
 const elevation=clamp(Math.asin(direction.y)+orbitY,depth<0?-.02:.08,1.38);
 camera.position.set(Math.sin(az)*Math.cos(elevation)*dist,Math.sin(elevation)*dist,Math.cos(az)*Math.cos(elevation)*dist);
 camera.lookAt(0,0,0);camera.clearViewOffset();camera.fov=depth<0?THREE.MathUtils.lerp(43,67,blend(depth+1)):40+27*(1-blend(Math.min(depth,1)));camera.near=.025;camera.far=700;camera.updateProjectionMatrix();
 for(let j=0;j<groups.length;j++){
  const g=groups[j];g.position.copy(anchors[j]).sub(worldTarget).divideScalar(unit);
  if(j===0)g.position.copy(worldTarget).multiplyScalar(-1/unit);
  g.scale.setScalar(absScales[j]/unit);if(j>0)g.rotation.y=yaw;
  const fade=j===0?1-smooth(clamp((depth-.55)/.38,0,1)):j<4?1-smooth(clamp((depth-j-.58)/.35,0,1)):1;
  fadeGroup(g,(j===0||depth>=j-.95)&&depth<=j+1.03?fade:0);
 }
 glow.position.set(-3,4,6);
}
const maintenanceCrew=loaderMode?{update(){}}:createMaintenanceCrew(floor,reduced);
let crewTime=0;
const cachedMaterials=new Map();
for(const g of groups){const list=new Set();g.traverse(o=>{if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material])){m.userData.baseOpacity=m.opacity;if(m.visible!==false)list.add(m);}});cachedMaterials.set(g,[...list]);}
function fadeGroup(g,opacity){g.visible=opacity>.005;if(!g.visible)return;for(const m of cachedMaterials.get(g)){const transparent=opacity<.995||m.userData.baseOpacity<1;if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}m.opacity=m.userData.baseOpacity*opacity;m.depthWrite=opacity>.5;}}
function setTour(on){tour=on;$('#play-symbol').innerHTML=on?'<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>':'<path d="m9 5 10 7-10 7z"/>';$('#tour-button').setAttribute('aria-label',on?'Pause market journey':'Play market journey');if(on)extracted=true;}
function go(n){targetDepth=clamp(n,-2,4);orbitX=0;orbitY=0;if(n>0)extracted=true;$('#gpu-tip').style.opacity='0';}
function updateChapter(){const index=clamp(Math.floor(depth+.47),-2,4);if(index===activeStage)return;activeStage=index;$('#product-line').hidden=index>=0;$('#machine-income').hidden=index<0;$('#explode-button').hidden=index!==1;document.querySelectorAll('[data-stage]').forEach((el,i)=>{const match=index===Number(el.dataset.stage);el.classList.toggle('active',match);el.setAttribute('aria-current',match?'step':'false');});}
function selectGPU(n){touched=true;setTour(false);selectedGPU=n;selectedRack=Math.floor(n/8);updateNote();extracted=true;exploded=false;activeStage=-1;go(0);$('#gpu-picker').hidden=true;$('#gpu-button').setAttribute('aria-expanded','false');document.querySelectorAll('[data-gpu]').forEach(el=>el.classList.toggle('selected',Number(el.dataset.gpu)===n%8));}
function tick(ms){requestAnimationFrame(tick);const dt=Math.min((ms-lastTime)/1000,.05)||.016;lastTime=ms;if($('#money-preview').hidden)elapsed+=dt;
 if(loaderMode&&!loaderDone){const endDepth=2.98,t=clamp(elapsed/9.2,0,1),ease=t*t*t*(t*(t*6-15)+10);targetDepth=-2+(endDepth+2)*ease;extracted=t>.24;if(t>=1&&Math.abs(depth-endDepth)<.015){loaderDone=true;setTimeout(()=>parent.postMessage({type:'sxg-loader-complete'},'*'),180);}}
 const r=rackLayout[selectedRack];focusPosition.lerp(V(r.x,extracted?gpuModules[selectedGPU].userData.homeY*.75:.1,r.z),reduced?1:1-Math.exp(-dt*3.5));
 if(tour){targetDepth+=dt*.075*tourDirection;if(targetDepth>=4.25)tourDirection=-1;if(targetDepth<=-1.25)tourDirection=1;}
 depth+=(clamp(targetDepth,-2,4)-depth)*(reduced?1:1-Math.exp(-dt*3.5));if(Math.abs(clamp(targetDepth,-2,4)-depth)<.0001)depth=clamp(targetDepth,-2,4);
 gpuModules.forEach((g,i)=>{const dest=i===selectedGPU&&extracted?2.4:0;g.userData.pull+=(dest-g.userData.pull)*(reduced?1:1-Math.exp(-dt*3));g.position.z=g.userData.homeZ+Math.cos(g.rotation.y)*g.userData.pull;g.position.x=g.userData.homeX+Math.sin(g.rotation.y)*g.userData.pull;const changed=Math.abs((g.userData.lastPull??-1)-g.userData.pull)>.00002;if(changed){g.userData.lastPull=g.userData.pull;for(const ref of g.userData.instances){g.updateMatrix();const m=ref.local.clone().premultiply(g.matrix);ref.mesh.setMatrixAt(ref.index,m);ref.mesh.instanceMatrix.needsUpdate=true;}}});
 if(!document.hidden && depth<.95){crewTime+=dt;maintenanceCrew.update(crewTime);}
 updateChapter();placeWorld();explodeAmount+=(Number(exploded&&depth<1.45)-explodeAmount)*(1-Math.exp(-dt*4));chipAssembly.position.y=explodeAmount*.85;
 heatsink.visible=activeStage===1&&explodeAmount>.01;heatsink.position.set(explodeAmount*1.2,explodeAmount*2.8,-explodeAmount*1.6);
 particles.forEach((m,i)=>{const ph=((reduced?0:elapsed)*.13+m.userData.offset)%1;m.position.set(-4.3+ph*8.6,i<10?.3:.58,(i%7-3)*.6);});
 $('#progress').style.width=(depth+2)/6*100+'%';renderer.render(scene,camera);
}
requestAnimationFrame(tick);setTimeout(()=>{$('#loading').classList.add('done');$('#loading').setAttribute('aria-hidden','true');},500);
function resize(){renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);
$('#experience').addEventListener('wheel',e=>{if(e.target.closest('#about,#money-preview,#gpu-picker,#wallet-control'))return;e.preventDefault();touched=true;setTour(false);extracted=true;targetDepth=clamp(targetDepth+clamp(e.deltaY,-100,100)*.0016,-2,4);},{passive:false});
view.addEventListener('pointerdown',e=>{if(e.button!==0)return;touched=true;setTour(false);drag={x:e.clientX,y:e.clientY,ox:orbitX,oy:orbitY,touch:e.pointerType==='touch',depth:targetDepth};dragged=false;view.setPointerCapture(e.pointerId);});
function hitGPU(e){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1),camera);const hits=ray.intersectObjects([...gpuTargets,...clickable]);return hits[0];}
view.addEventListener('pointermove',e=>{if(!drag){const hit=depth<.45?hitGPU(e):null;view.style.cursor=hit?'pointer':'grab';const tip=$('#gpu-tip');if(hit){const d=hit.object.userData;tip.textContent=d.gpu!==undefined?`P${String(Math.floor(d.gpu/8)+1).padStart(2,'0')} / API ${String(d.gpu%8+1).padStart(2,'0')}`:`PROVIDER ${String(d.rack).padStart(2,'0')}`;tip.style.left=Math.min(e.clientX+15,innerWidth-80)+'px';tip.style.top=(e.clientY-30)+'px';tip.style.opacity='1';}else tip.style.opacity='0';return;}$('#gpu-tip').style.opacity='0';const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>6)dragged=true;if(drag.touch&&Math.abs(dy)>Math.abs(dx)*1.3){extracted=true;targetDepth=clamp(drag.depth-dy*.004,-2,4);}else{orbitX=drag.ox+dx*.0035;orbitY=clamp(drag.oy+dy*.002,-.25,.5);}});
view.addEventListener('pointerleave',()=>$('#gpu-tip').style.opacity='0');
view.addEventListener('pointerup',e=>{if(drag&&!dragged&&depth<.55){const hit=hitGPU(e);if(hit){const d=hit.object.userData,n=d.gpu??((d.rack-1)*8+5);if(depth<-.35){selectGPU(n);extracted=false;openNote(true);}else if(selectedGPU===n&&extracted)go(1);else selectGPU(n);}}drag=null;});
view.addEventListener('pointercancel',()=>drag=null);
document.querySelectorAll('[data-stage]').forEach(el=>el.onclick=()=>{touched=true;setTour(false);go(Number(el.dataset.stage));});
document.querySelectorAll('[data-gpu]').forEach(el=>el.onclick=()=>selectGPU(selectedRack*8+Number(el.dataset.gpu)));
const rackSelector=document.createElement('select');rackSelector.id='rack-choice';rackSelector.setAttribute('aria-label','Choose a provider route');rackSelector.innerHTML=rackLayout.map(r=>`<option value="${r.index}">PROVIDER ${String(r.index+1).padStart(2,'0')}</option>`).join('');$('#gpu-picker').prepend(rackSelector);rackSelector.onchange=()=>{selectGPU(Number(rackSelector.value)*8+5);extracted=false;openNote(true);};
$('#gpu-button').onclick=()=>{rackSelector.value=String(selectedRack);const open=$('#gpu-picker').hidden;$('#gpu-picker').hidden=!open;$('#gpu-button').setAttribute('aria-expanded',String(open));document.querySelectorAll('[data-gpu]').forEach(el=>el.classList.toggle('selected',Number(el.dataset.gpu)===selectedGPU%8));};
$('#home').onclick=$('#reset-button').onclick=()=>{closeNote();$('#job-overlay').hidden=true;touched=true;setTour(false);extracted=false;exploded=false;activeStage=-2;go(-1);};
$('#tour-button').onclick=()=>{touched=true;if(!tour&&depth>=4)tourDirection=-1;setTour(!tour);};
$('#explode-button').onclick=()=>{exploded=!exploded;$('#explode-button').setAttribute('aria-pressed',String(exploded));$('#explode-button').setAttribute('aria-label',exploded?'Assemble API layers':'Inspect API layers');};
$('#info-button').onclick=()=>{const open=$('#about').hidden;$('#about').hidden=!open;$('#info-button').setAttribute('aria-expanded',String(open));};
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#money-preview').hidden){closeNote();return;}if(e.target.closest('button,select,input,summary,#money-preview'))return;if(['ArrowDown','ArrowRight','PageDown'].includes(e.key)){e.preventDefault();touched=true;setTour(false);go(Math.round(targetDepth)+1);}if(['ArrowUp','ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();touched=true;setTour(false);go(Math.round(targetDepth)-1);}if(e.key==='Home'){e.preventDefault();touched=true;setTour(false);go(-1);}if(e.key==='Escape'){$('#about').hidden=true;$('#gpu-picker').hidden=true;$('#info-button').setAttribute('aria-expanded','false');$('#gpu-button').setAttribute('aria-expanded','false');}if(e.code==='Space'&&document.activeElement===document.body){e.preventDefault();touched=true;setTour(!tour);}});

let noteFocus=null;
const assetName=n=>`PROVIDER ${String(Math.floor(n/8)+1).padStart(2,'0')} / API ${String(n%8+1).padStart(2,'0')}`;
const accountPanel=initServicePanel({root:$('#service-panel'),getGPU:()=>selectedGPU});
function updateNote(){$('#money-asset').textContent=assetName(selectedGPU);$('#income-asset').textContent=assetName(selectedGPU);$('#income-amount').textContent='Open API market';accountPanel.update();}
function openNote(keepMotion=false){noteFocus=document.activeElement;setTour(false);if(!keepMotion)targetDepth=depth;$('#gpu-picker').hidden=true;$('#gpu-button').setAttribute('aria-expanded','false');updateNote();$('#money-preview').hidden=false;document.body.classList.add('note-open');$('#product-line').inert=true;$('#machine-income').inert=true;$('#money-button').setAttribute('aria-expanded','true');$('#about').hidden=true;$('#info-button').setAttribute('aria-expanded','false');$('#close-money').focus();accountPanel.refresh();}
function closeNote(){$('#money-preview').hidden=true;document.body.classList.remove('note-open');$('#product-line').inert=false;$('#machine-income').inert=false;$('#money-button').setAttribute('aria-expanded','false');if(noteFocus?.isConnected&&!noteFocus.closest('[hidden]'))noteFocus.focus();else $('#money-button').focus();}
$('#inspect-source').onclick=()=>{closeNote();selectGPU(selectedGPU);go(1);};
$('#money-button').onclick=()=>$('#money-preview').hidden?openNote():closeNote();$('#explore-notes').onclick=()=>openNote();$('#machine-income').onclick=()=>openNote();$('#close-money').onclick=closeNote;
updateNote();
