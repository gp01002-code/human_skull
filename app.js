import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { VRButton } from './vendor/VRButton.js';
import { MeshBVH, acceleratedRaycast } from './vendor/bvh.module.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = new THREE.Scene();
const puzzle = new THREE.Group();scene.add(puzzle);
const camera = new THREE.PerspectiveCamera(38, 1, .005, 20);
const rig = new THREE.Group(); scene.add(rig); rig.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .95;
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(1);
$('viewport').appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .09;
controls.minDistance = .28; controls.maxDistance = 1.8;
controls.maxPolarAngle = Math.PI * .87;
controls.enablePan = false; controls.autoRotateSpeed = .55;
const targetRotation = new THREE.Quaternion();
const objects = [], references = [], transitions = new Map(), controllers = [];
let contextMesh = null;
let definitions = [], active = null, drag = null, playing = false, ready = false, placed = 0;
let ghostVisible = true, startTime = null, elapsed = 0, lastTime = performance.now(), hoverEvent = null;
let hintUntil = 0, toastTimer, dirty = true, settlingUntil = 0, frameCount = 0, lastFpsTime = 0, fps = 0;
const raycaster = new THREE.Raycaster(); raycaster.firstHitOnly = true;
const mouse = new THREE.Vector2(), plane = new THREE.Plane(), point = new THREE.Vector3(), offset = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4(), tempQuaternion = new THREE.Quaternion();
const forward = new THREE.Vector3(), right = new THREE.Vector3();
const boneColors = { unplaced: 0xd8d3c5, selected: 0xe3a835, placed: 0x63a59a };
const viewAzimuth = Math.PI * .32;
const material = new THREE.MeshStandardMaterial({ color: boneColors.unplaced, roughness: .67, metalness: .04 });
const referenceMaterial = new THREE.MeshBasicMaterial({ color: 0xc7a363, transparent: true, opacity: .10, depthWrite: false });
scene.add(new THREE.HemisphereLight(0xf0ebe1, 0x493b30, 1.55));
function light(color, intensity, x, y, z) { const l = new THREE.DirectionalLight(color, intensity); l.position.set(x,y,z); scene.add(l); }
light(0xfff2df, 2.5, -.4, .7, .8); light(0xe4d8c6, 1.4, .5, .2, -.4); light(0xffffff, .7, 0, -.2, .5);

// Lightweight stage: no mirror render, shadow pass, bloom buffer, or per-frame texture upload.
const stage = new THREE.Group(); puzzle.add(stage);
const disc = new THREE.Mesh(new THREE.CircleGeometry(.30, 96), new THREE.MeshBasicMaterial({ color: 0x573c27, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide }));
disc.rotation.x = -Math.PI/2; disc.position.y = -.20; stage.add(disc);
for (const radius of [.17, .30]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius+.0008, 96), new THREE.MeshBasicMaterial({color:0xc8a35d,transparent:true,opacity:.23,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2; ring.position.y=-.199; stage.add(ring);
}
const halo = new THREE.Mesh(new THREE.SphereGeometry(1,24,12), new THREE.MeshBasicMaterial({color:0xd3b16e,wireframe:true,transparent:true,opacity:0,depthWrite:false}));
halo.scale.setScalar(.02); puzzle.add(halo); let haloStart=-10000;
// Local 2:1 panorama: one inward-facing draw, without reflective lighting or extra render passes.
let panorama = null;
new THREE.TextureLoader().load('./assets/classroom-panorama.png', texture => {
  texture.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.MeshBasicMaterial({ map: texture, color: 0xb8b8b8, side: THREE.BackSide, depthWrite: false, toneMapped: false });
  panorama = new THREE.Mesh(new THREE.SphereGeometry(8, 48, 24), backdrop);
  panorama.scale.x = -1;
  panorama.rotation.y = viewAzimuth - Math.PI / 2;
  panorama.renderOrder = -100;
  panorama.frustumCulled = false;
  panorama.onBeforeRender = (_renderer, _scene, viewCamera) => {
    viewCamera.getWorldPosition(panorama.position);
    panorama.updateMatrixWorld();
  };
  scene.add(panorama);
  stage.visible = false;
  invalidate();
}, undefined, error => {
  console.warn('環景載入失敗，保留棕色背景。', error);
  toast('環景載入失敗，請重新整理頁面。');
});
function invalidate() { dirty=true; settlingUntil=performance.now()+1200; }
controls.addEventListener('change', () => { dirty=true; });
controls.addEventListener('start', invalidate);
controls.addEventListener('end', invalidate);

function resize() {
  const {width,height}=$('viewport').getBoundingClientRect();
  camera.aspect=width/height; camera.updateProjectionMatrix(); renderer.setSize(width,height); if(!drag&&!renderer.xr.isPresenting)fitView(); invalidate();
}
new ResizeObserver(resize).observe($('viewport'));
function quality() {
  const max={performance:1,balanced:1.5,high:2}[$('quality').value];
  renderer.setPixelRatio(Math.min(devicePixelRatio,max)); resize();
}
$('quality').addEventListener('change',quality); quality();
function fitView(){
  const distance=playing?Math.max(1.20,.98/camera.aspect):Math.max(.67,.43/camera.aspect);
  const direction=camera.position.clone().sub(controls.target).normalize();
  if(direction.lengthSq()===0)direction.set(0,.08,1).normalize();
  camera.position.copy(controls.target).addScaledVector(direction,distance);
  controls.maxDistance=Math.max(2,distance*1.8);
}
function home() { controls.target.set(0,playing?-.025:.012,0);camera.position.set(Math.sin(viewAzimuth)*.7,.055,Math.cos(viewAzimuth)*.7);fitView(); controls.update(); invalidate(); }
home();
$('home').onclick=home;
$('rotate').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('rotate').setAttribute('aria-pressed',controls.autoRotate);invalidate();};
$('ghost').onclick=()=>{ghostVisible=!ghostVisible;$('ghost').setAttribute('aria-pressed',ghostVisible);updateReferences();invalidate();};
function toast(message) { clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600); }
function applyBoneAppearance(bone) {
  const selected = bone===active && !bone.userData.placed;
  bone.material.color.set(bone.userData.placed ? boneColors.placed : selected ? boneColors.selected : boneColors.unplaced);
  bone.material.emissive.set(selected ? 0x604012 : 0x000000);
  bone.material.emissiveIntensity = selected ? .16 : 0;
}
function select(mesh, force=false) {
  if (active===mesh && !force) return;
  active=mesh;
  for (const bone of objects) {
    const selected=bone===mesh;
    applyBoneAppearance(bone);
    bone.userData.button.classList.toggle('active',selected);
  }
  if(mesh){$('bone-name').textContent=mesh.userData.name;$('bone-description').textContent=mesh.userData.description;$('detail-kicker').textContent=mesh.userData.placed?'已完成拼合':'骨骼檔案';}
  if(!mesh){$('bone-name').textContent='點選一塊骨骼';$('bone-description').textContent='象牙色為未拼合，琥珀金為選取中，青綠色為已拼合。';$('detail-kicker').textContent='學習提示';}
  $('hint').disabled=!mesh||!playing||mesh.userData.placed;
  updateReferences(); invalidate();
}
function updateReferences(){for(const ref of references){const bone=ref.userData.bone;ref.visible=playing&&!bone.userData.placed&&ghostVisible;ref.material.opacity=bone===active?.27:.075;}}
$('hint').onclick=()=>{
  if(!active||active.userData.placed)return;
  ghostVisible=true;$('ghost').setAttribute('aria-pressed','true');hintUntil=performance.now()+4000;updateReferences();
  toast('發光輪廓是目標位置；拖曳骨骼靠近即可吸附。');invalidate();
};
function timeString(ms){const s=Math.floor(ms/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function updateProgress(){ $('count').textContent=String(placed).padStart(2,'0');$('progress').style.width=`${placed/definitions.length*100}%`; }
function animateTo(mesh,destination,onDone){
  transitions.set(mesh,{from:mesh.position.clone(),to:destination.clone(),start:performance.now(),duration:reducedMotion?1:420,onDone});invalidate();
}
function release(mesh){
  if(!mesh||mesh.userData.placed)return;
  const data=mesh.userData;
  if(mesh.position.distanceTo(data.target)<.033){
    data.placed=true;placed++;mesh.quaternion.copy(targetRotation);
    applyBoneAppearance(mesh);data.button.classList.add('placed');data.button.querySelector('.mark').textContent='✓';
    halo.position.copy(data.target);haloStart=performance.now();
    animateTo(mesh,data.target);updateProgress();updateReferences();$('hint').disabled=true;
    $('detail-kicker').textContent='已完成拼合';toast(`${data.name}已就位 · ${placed} / ${definitions.length}`);
    if(placed===definitions.length){elapsed=startTime===null?0:performance.now()-startTime;startTime=null;playing=false;if(contextMesh)contextMesh.material.color.set(boneColors.placed);stage.position.y=0;$('mode-label').textContent='組裝完成';$('final-time').textContent=timeString(elapsed);setTimeout(()=>{if(!playing&&placed===definitions.length&&!renderer.xr.isPresenting)$('complete').showModal();},650);}
  }else{animateTo(mesh,data.initial);toast('再靠近透明輪廓一點，就能拼合。');}
  invalidate();
}
function begin(){
  if(!ready)return;
  if($('complete').open)$('complete').close();
  endDrag(false);
  for(const state of controllers){if(state.selected){puzzle.attach(state.selected);state.selected=null;}}
  transitions.clear();if(contextMesh)contextMesh.material.color.set(boneColors.unplaced);stage.position.y=-.14;placed=0;elapsed=0;startTime=null;playing=true;controls.autoRotate=false;
  $('rotate').setAttribute('aria-pressed','false');$('start').hidden=true;$('reset').hidden=false;
  $('mode-label').textContent='拼圖挑戰';$('timer').textContent='00:00';
  for(const mesh of objects){mesh.userData.placed=false;mesh.material.color.set(boneColors.unplaced);mesh.userData.button.classList.remove('placed');mesh.userData.button.querySelector('.mark').textContent='○';animateTo(mesh,mesh.userData.initial);}
  select(null,true);updateProgress();updateReferences();home();toast('點選骨骼查看說明，拖曳至中央開始拼圖。');
}
$('start').onclick=begin;$('reset').onclick=begin;$('again').onclick=begin;$('inspect').onclick=()=>{$('complete').close();home();};
function startTimer(){if(startTime===null&&playing)startTime=performance.now();}
function pointerCoordinates(event){const r=renderer.domElement.getBoundingClientRect();mouse.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);}
function pick(){scene.updateMatrixWorld(true);return raycaster.intersectObjects(objects.filter(o=>!playing||(!o.userData.placed&&!transitions.has(o))),false)[0]?.object;}
const canvas=renderer.domElement;
canvas.addEventListener('pointerdown',event=>{
  if(renderer.xr.isPresenting||event.button!==0||drag)return;
  pointerCoordinates(event);raycaster.setFromCamera(mouse,camera);const mesh=pick();if(!mesh)return;
  select(mesh);if(!playing||mesh.userData.placed)return;
  event.stopImmediatePropagation();controls.enabled=false;startTimer();
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(plane.normal),mesh.position);
  raycaster.ray.intersectPlane(plane,point);offset.copy(mesh.position).sub(point);drag={mesh,pointerId:event.pointerId};canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';invalidate();
},true);
canvas.addEventListener('pointermove',event=>{if(renderer.xr.isPresenting)return;if(!drag||event.pointerId===drag.pointerId)hoverEvent={clientX:event.clientX,clientY:event.clientY};invalidate();});
function updatePointer(){
  if(!hoverEvent)return;pointerCoordinates(hoverEvent);hoverEvent=null;raycaster.setFromCamera(mouse,camera);
  if(drag){
    if(raycaster.ray.intersectPlane(plane,point))drag.mesh.position.copy(point).add(offset);
    // A screen-space magnet makes depth reachable with a mouse or one finger.
    const a=drag.mesh.position.clone().project(camera),b=drag.mesh.userData.target.clone().project(camera);
    const rect=canvas.getBoundingClientRect();const pixels=Math.hypot((a.x-b.x)*rect.width/2,(a.y-b.y)*rect.height/2);
    if(pixels<24)drag.mesh.position.copy(drag.mesh.userData.target);
    dirty=true;
  }else{const mesh=pick();canvas.style.cursor=mesh?'grab':'default';}
}
function endDrag(commit=true){if(!drag)return;updatePointer();const {mesh,pointerId}=drag;drag=null;if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);controls.enabled=!renderer.xr.isPresenting;canvas.style.cursor='default';if(commit)release(mesh);else if(playing)animateTo(mesh,mesh.userData.initial);invalidate();}
canvas.addEventListener('pointerup',event=>{if(drag?.pointerId===event.pointerId)endDrag();});
canvas.addEventListener('pointercancel',()=>endDrag(false));canvas.addEventListener('lostpointercapture',()=>endDrag(false));
window.addEventListener('blur',()=>endDrag(false));

// Local model data is fetched once; the target and movable piece share one geometry and BVH.
async function load(){
  const response=await fetch('./bones.json');if(!response.ok)throw new Error('無法讀取骨骼清單');definitions=await response.json();
  const worker=new Worker(new URL('./model-worker.js',import.meta.url),{type:'module'});
  try{
    const contextResponse=await fetch('./context.json');if(!contextResponse.ok)throw new Error('無法讀取輔助骨骼');
    const context={...await contextResponse.json(),id:'context',name:'牙齒與輔助骨骼',context:true};
    for(const [index,def] of [...definitions,context].entries()){
      $('load-message').textContent=def.context?'整理牙齒與輔助骨骼…':`${index+1} / ${definitions.length} · ${def.name}`;
      const data=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`${def.name}載入逾時`)),60000);worker.onmessage=e=>{clearTimeout(timeout);e.data.error?reject(new Error(`${def.name}：${e.data.error}`)):resolve(e.data);};worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message));};worker.postMessage({file:def.file,id:def.id});});
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.position,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normal,3));
      geometry.boundsTree=MeshBVH.deserialize(data.serialized,geometry);geometry.computeBoundingSphere();
      const mesh=new THREE.Mesh(geometry,material.clone());mesh.raycast=acceleratedRaycast;mesh.scale.setScalar(.012);mesh.quaternion.copy(targetRotation);mesh.position.fromArray(def.target);
      if(def.context){contextMesh=mesh;puzzle.add(mesh);break;}
      const button=document.createElement('button');button.className='bone-item';button.innerHTML=`<span class="number">${String(index+1).padStart(2,'0')}</span><span>${def.name}</span><span class="mark">○</span>`;
      button.onclick=()=>select(mesh);$('bone-list').appendChild(button);
      mesh.userData={...def,initial:new THREE.Vector3(...def.initial).applyAxisAngle(new THREE.Vector3(0,1,0),viewAzimuth),target:new THREE.Vector3(...def.target),placed:false,button};objects.push(mesh);puzzle.add(mesh);
      const ref=new THREE.Mesh(geometry,referenceMaterial.clone());ref.scale.copy(mesh.scale);ref.quaternion.copy(targetRotation);ref.position.copy(mesh.userData.target);ref.visible=false;ref.userData.bone=mesh;references.push(ref);puzzle.add(ref);
      $('load-progress').style.width=`${(index+1)/definitions.length*100}%`;dirty=true;
    }
  }finally{worker.terminate();}
  ready=true;$('loading').hidden=true;$('start').disabled=false;$('start').textContent='開始拼圖  →';$('status-text').textContent='工作台已就緒';select(null,true);invalidate();
}
$('retry').onclick=()=>location.reload();
load().catch(error=>{console.error(error);$('load-message').textContent=`載入未完成：${error.message}。請使用「啟動拼圖.cmd」開啟。`;$('retry').hidden=false;$('status-text').textContent='載入失敗';});

// XR keeps the two-controller interaction, with rotation locked for anatomical assembly.
if(navigator.xr)navigator.xr.isSessionSupported('immersive-vr').then(supported=>{
  if(supported){const vrButton=VRButton.createButton(renderer);document.body.appendChild(vrButton);}
}).catch(()=>{});
const vrCanvas=document.createElement('canvas');vrCanvas.width=512;vrCanvas.height=160;
const vrContext=vrCanvas.getContext('2d');const vrTexture=new THREE.CanvasTexture(vrCanvas);
const vrPanel=new THREE.Mesh(new THREE.PlaneGeometry(.25,.078),new THREE.MeshBasicMaterial({map:vrTexture,transparent:true,depthTest:false}));vrPanel.position.set(0,-.15,-.38);vrPanel.visible=false;camera.add(vrPanel);let vrText='';
function pulse(controller,amount){const source=controller.userData.source;source?.gamepad?.hapticActuators?.[0]?.pulse(amount,80)?.catch?.(()=>{});}
for(let index=0;index<2;index++){
  const controller=renderer.xr.getController(index);rig.add(controller);
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0xd3b16e}));line.scale.z=1;controller.add(line);
  const state={controller,line,selected:null,hover:null,rotation:new THREE.Quaternion()};controllers.push(state);
  controller.addEventListener('connected',e=>{controller.userData.source=e.data;});
  controller.addEventListener('disconnected',()=>{if(state.selected){puzzle.attach(state.selected);release(state.selected);state.selected=null;}controller.userData.source=null;});
  controller.addEventListener('selectstart',()=>{if(!ready)return;if(!playing){begin();return;}const mesh=controllerPick(state);if(!mesh||mesh.userData.placed||controllers.some(s=>s.selected===mesh))return;startTimer();select(mesh);state.selected=mesh;mesh.getWorldQuaternion(state.rotation);controller.attach(mesh);pulse(controller,.3);});
  controller.addEventListener('selectend',()=>{if(!state.selected)return;const mesh=state.selected;puzzle.attach(mesh);state.selected=null;release(mesh);pulse(controller,mesh.userData.placed?.8:.2);});
  controller.addEventListener('squeezestart',()=>{if(!playing&&ready)begin();});
}
function controllerPick(state){state.controller.updateWorldMatrix(true,false);tempMatrix.extractRotation(state.controller.matrixWorld);raycaster.ray.origin.setFromMatrixPosition(state.controller.matrixWorld);raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMatrix);return pick();}
renderer.xr.addEventListener('sessionstart',()=>{endDrag(false);controls.enabled=false;rig.position.set(0,0,.5);puzzle.position.set(0,1.2,-.35);vrPanel.visible=true;vrText='';invalidate();});
renderer.xr.addEventListener('sessionend',()=>{for(const state of controllers){if(state.selected){puzzle.attach(state.selected);release(state.selected);state.selected=null;}}rig.position.set(0,0,0);puzzle.position.set(0,0,0);vrPanel.visible=false;controls.enabled=true;home();});
function updateXR(dt){
  for(const state of controllers){
    if(state.selected){state.controller.getWorldQuaternion(tempQuaternion).invert();state.selected.quaternion.copy(state.rotation).premultiply(tempQuaternion);}
    else{state.hover=controllerPick(state);state.line.material.color.set(state.hover?0xe8c690:0xb6dcc8);if(state.hover)select(state.hover);}
    const source=state.controller.userData.source,axes=source?.gamepad?.axes;
    if(axes?.length>=4){const x=Math.abs(axes[2])>.15?axes[2]:0,z=Math.abs(axes[3])>.15?axes[3]:0;renderer.xr.getCamera().getWorldQuaternion(tempQuaternion);forward.set(0,0,-1).applyQuaternion(tempQuaternion);forward.y=0;forward.normalize();right.set(1,0,0).applyQuaternion(tempQuaternion);right.y=0;right.normalize();rig.position.addScaledVector(forward,-z*dt*.35);if(source.handedness==='left')rig.position.addScaledVector(right,x*dt*.35);}
  }
  const message=`${placed} / ${definitions.length}   ${timeString(elapsed)}\n${!playing?(placed===definitions.length?'組裝完成！扣下扳機再玩一次':'扣下扳機，開始拼圖'):active?.userData.name||'指向骨骼，扣下扳機拖曳'}`;
  if(message!==vrText){vrText=message;vrContext.clearRect(0,0,512,160);vrContext.fillStyle='#312116ee';vrContext.fillRect(0,0,512,160);vrContext.fillStyle='#e3c685';vrContext.font='26px sans-serif';message.split('\n').forEach((line,i)=>vrContext.fillText(line,20,55+i*55));vrTexture.needsUpdate=true;}
}
renderer.setAnimationLoop(now=>{
  const dt=Math.min((now-lastTime)/1000,.05);lastTime=now;
  if(document.hidden&&!renderer.xr.isPresenting)return;
  if(startTime!==null){elapsed=now-startTime;const str=timeString(elapsed);if($('timer').textContent!==str)$('timer').textContent=str;}
  updatePointer();
  if(renderer.xr.isPresenting)updateXR(dt);else if(dirty||controls.autoRotate||now<settlingUntil)controls.update();
  for(const [mesh,t]of transitions){const p=Math.min(1,(now-t.start)/t.duration);mesh.position.lerpVectors(t.from,t.to,1-Math.pow(1-p,3));if(p===1){transitions.delete(mesh);t.onDone?.();}dirty=true;}
  if(hintUntil>now&&active){const ref=references[objects.indexOf(active)];ref.material.opacity=.25+Math.sin(now*.007)*.13;dirty=true;}
  else if(hintUntil){hintUntil=0;updateReferences();dirty=true;}
  const hp=(now-haloStart)/650;if(hp<1&&!reducedMotion){halo.visible=true;halo.scale.setScalar(.015+hp*.085);halo.material.opacity=(1-hp)*.25;dirty=true;}else if(halo.visible){halo.visible=false;dirty=true;}
  if(dirty||renderer.xr.isPresenting||controls.autoRotate){renderer.render(scene,camera);dirty=false;frameCount++;}
  if(now-lastFpsTime>1000){fps=frameCount;frameCount=0;lastFpsTime=now;}
});

// Read-only diagnostics for profiling; available from the browser console.
window.skullDiagnostics=()=>({ready,playing,placed,bones:objects.length,geometryCount:renderer.info.memory.geometries,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,renderedFramesLastSecond:fps,pixelRatio:renderer.getPixelRatio(),sharedGeometry:objects.every((o,i)=>o.geometry===references[i].geometry),bvh:objects.every(o=>!!o.geometry.boundsTree)});

