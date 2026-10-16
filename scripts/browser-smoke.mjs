import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH
 ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href : 'playwright');

// Test the real editor, import/load wall protection, and rendered WebGL scene.
// Screenshots still require human comparison with the uploaded original image.
const screenshotDir=process.env.FLOORPLAN_SCREENSHOT_DIR || 'screenshots';
const baseURL=process.env.FLOORPLAN_URL || 'http://127.0.0.1:8765/index.html';
fs.mkdirSync(screenshotDir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],
 ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.stack || e.message));
page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
const screenshot=name=>page.screenshot({path:path.join(screenshotDir,name),fullPage:true});
const removed=()=>page.evaluate(()=>[...state.demolished]);
const waitRemoval=ids=>page.waitForFunction(expected=>JSON.stringify(state.demolished)===JSON.stringify(expected),ids);
async function importState(value){
 const history=await page.evaluate(()=>undoStack.length);
 await page.locator('#fileIn').setInputFiles({name:'regression-plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
 await page.waitForFunction(n=>undoStack.length===n+1,history);
 await page.waitForFunction(()=>/方案已导入|Plan imported/.test(document.querySelector('#toast').textContent));
}
async function view(mode){
 await page.locator(`#viewSeg button[data-view="${mode}"]`).click();
 await page.waitForFunction(mode=>!switching && viewMode===mode,mode,{timeout:45000});
}
try{
 await page.goto(baseURL,{waitUntil:'load',timeout:45000});
 await page.waitForFunction(()=>document.querySelectorAll('#gWalls rect').length>=30,{timeout:15000});
 assert.ok((await page.locator('.brand b').textContent()).includes('中环和润苑'),'Wrong floorplan loaded');
 assert.equal(await page.locator('#gRooms polygon').count(),7,'Expected seven floor zones');
 const printedNames=(await page.locator('#gLabels text').allTextContents()).filter(t=>!t.includes('m²')).sort();
 assert.deepEqual(printedNames,['客厅','厨房','卫生间','卧室A','卧室B','阳台'].sort(),'Room labels differ from source');
 const dimensions={north:['2887','3156','1572','2883'],south:['2887','1912','3118','1397'],west:['1694','1436','3651','1483'],east:['2794','2925','3651','1483']};
 for(const [side,values] of Object.entries(dimensions))
  assert.deepEqual(await page.locator(`[data-source-chain="${side}"] text`).allTextContents(),values,'Rendered source dimension chain: '+side);
 assert.equal(await page.locator('[data-source-dimension]').count(),16,'Unprinted dimensions were added');
 const initial=await page.evaluate(()=>JSON.parse(JSON.stringify(state)));
 const ids=await page.evaluate(()=>({
  candidate:'w'+WALLS.findIndex(w=>w[4]==='n'),
  protected:WALLS.map((w,i)=>w[4]!=='n'?'w'+i:null).filter(Boolean)
 }));
 assert.notEqual(ids.candidate,'w-1','Missing removable partition');
 assert.ok(ids.protected.length>20,'Most walls must be protected');

 // Capture the untouched source layout before destructive-editor test actions.
 await screenshot('plan-2d.png');
 const furnitureShown=await page.evaluate(()=>ui.layers.furn);
 if(furnitureShown) await page.locator('#layers [data-layer="furn"]').click();
 await screenshot('plan-2d-architecture.png');
 if(furnitureShown) await page.locator('#layers [data-layer="furn"]').click();
 console.log('✓ 2D loaded and baseline screenshots saved');

 await page.locator('#tools [data-tool="demolish"]').click();
 await page.locator(`[data-wall="${ids.protected[0]}"]`).click({force:true});
 assert.deepEqual(await removed(),[],'Protected wall changed through UI');
 await page.locator(`[data-wall="${ids.candidate}"]`).click({force:true});
 await waitRemoval([ids.candidate]);
 await page.locator('#undo').click(); await waitRemoval([]);
 await page.locator('#redo').click(); await waitRemoval([ids.candidate]);
 await page.locator('#undo').click(); await waitRemoval([]);
 console.log('✓ Candidate-wall removal, protected-wall guard, undo and redo');

 // JSON imports and local saves must not bypass protected-wall constraints.
 const tainted={...initial,demolished:[...ids.protected,ids.candidate,ids.candidate,'w-1','w9999','w01',null,{},3]};
 await importState(tainted); await waitRemoval([ids.candidate]);
 assert.deepEqual(await removed(),[ids.candidate],'Import accepted protected, malformed, or duplicate wall IDs');
 await importState({...initial,demolished:{includes:true}}); await waitRemoval([]);
 await page.evaluate(value=>localStorage.setItem(STORE,JSON.stringify(value)),tainted);
 await page.reload({waitUntil:'load'});
 await waitRemoval([ids.candidate]);
 assert.deepEqual(await removed(),[ids.candidate],'Stored state bypassed wall protection');
 await importState(initial); await waitRemoval([]);
 console.log('✓ Import and localStorage sanitize protected and malformed wall IDs');

 // Measurements remain interactive but must disclose the inferred scale.
 await page.locator('#tools [data-tool="measure"]').click();
 const measurePoints=await page.evaluate(()=>[[400,450],[480,450]].map(([x,y])=>{
  const p=svg.createSVGPoint(); [p.x,p.y]=tracePoint(x,y);
  const screen=p.matrixTransform(svg.getScreenCTM()); return {x:screen.x,y:screen.y};
 }));
 for(const p of measurePoints) await page.mouse.click(p.x,p.y);
 await page.waitForFunction(()=>state.measures.length===1);
 assert.match(await page.locator('#gMeasure text').first().textContent(),/^≈\d+ mm$/,'Inferred measurement is presented as exact');
 await page.locator('#undo').click();
 assert.equal(await page.evaluate(()=>state.measures.length),0,'Measurement undo failed');
 console.log('✓ Measurement tool labels inferred lengths with ≈ and supports undo');

 // Furniture controls stay usable after the floorplan data replacement.
 await page.locator('#tools [data-tool="select"]').click();
 if(!await page.evaluate(()=>ui.layers.furn)) await page.locator('#layers [data-layer="furn"]').click();
 const before=await page.locator('#gFurn [data-fid]').count();
 await page.locator('#lib .item').first().click();
 await page.waitForFunction(n=>state.furniture.length===n+1,before);
 const added=await page.evaluate(()=>({...state.furniture.at(-1)}));
 await page.keyboard.press('r');
 assert.equal(await page.evaluate(id=>getF(id).rot,added.id),(added.rot+90)%360,'Furniture rotation failed');
 await page.locator('#undo').click();
 assert.equal(await page.evaluate(id=>getF(id).rot,added.id),added.rot,'Undo did not restore furniture rotation');
 await page.locator('#redo').click();
 assert.equal(await page.evaluate(id=>getF(id).rot,added.id),(added.rot+90)%360,'Redo did not restore furniture rotation');
 await page.keyboard.press('Delete');
 assert.equal(await page.locator('#gFurn [data-fid]').count(),before,'Furniture delete failed');
 await importState(initial);
 if(!furnitureShown) await page.locator('#layers [data-layer="furn"]').click();
 console.log('✓ Furniture add, rotate, undo, redo and delete');

 await page.waitForFunction(()=>!!window.View3D,{timeout:45000});
 const before3D=await page.evaluate(()=>JSON.stringify(state));
 await view('3d');
 const canvas=page.locator('#view3d canvas');
 await canvas.waitFor({state:'visible',timeout:25000});
 const furniture3D=page.locator('#toggles3d [data-t="furn"]');
 if(await furniture3D.evaluate(b=>b.classList.contains('on'))) await furniture3D.click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 // An initialized but blank canvas is not sufficient evidence of a valid scene.
 const render=await canvas.evaluate(c=>{
  const gl=c.getContext('webgl2') || c.getContext('webgl');
  if(!gl) return {width:c.width,height:c.height,colors:0};
  const colors=new Set(),pixel=new Uint8Array(4);
  for(let y=1;y<16;y++) for(let x=1;x<16;x++){
   gl.readPixels(Math.floor(c.width*x/16),Math.floor(c.height*y/16),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
   colors.add(Array.from(pixel).join(','));
  }
  return {width:c.width,height:c.height,colors:colors.size};
 });
 assert.ok(render.width>300&&render.height>300&&render.colors>12,'3D scene is empty or not rendered: '+JSON.stringify(render));
 await screenshot('plan-3d.png');
 await page.locator('[data-cut="1.2"]').click();
 await page.locator('#vTop').click();
 await page.waitForTimeout(1100); // Camera transition is 900 ms.
 await screenshot('plan-3d-top.png');
 await view('2d');
 assert.equal(await page.evaluate(()=>JSON.stringify(state)),before3D,'2D/3D switching changed the plan');
 assert.equal(errors.length,0,'Browser errors: '+errors.join('; ').slice(0,1600));
 console.log('✓ Rendered WebGL scene, cutaway/top view and lossless 2D/3D round-trip',render);
 console.log('Screenshots:',path.resolve(screenshotDir));
}catch(error){
 console.error('Browser diagnostics:',errors);
 await screenshot('failure.png').catch(()=>{});
 throw error;
}finally{
 await browser.close();
}
