import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

// 浏览器冒烟测试：检查 2D 加载与 3D 场景可见。
// 截图用于人工复核几何外形；自动通过不表示尺寸与原图绝对一致。
fs.mkdirSync('screenshots',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:950},deviceScaleFactor:1});
const errs=[];
page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{if(m.type()==='error') errs.push(m.text());});
try{
 await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load',timeout:30000});
 await page.waitForFunction(()=>document.querySelectorAll('#gWalls rect').length>=30,{timeout:15000});
 await page.screenshot({path:'screenshots/plan-2d.png',fullPage:true});
 const title=await page.locator('.brand b').textContent();
 console.log('Page title:',title);
 assert.ok(title.includes('中环和润苑'),'加载到错误的户型');
 const n=await page.locator('#gRooms polygon').count();
 assert.equal(n,7,'二维房间数量不符合预期');
 console.log('✓ 2D loaded, rooms:',n);
 await page.waitForFunction(()=>!!window.View3D,{timeout:30000});
 await page.locator('#viewSeg button[data-view="3d"]').click();
 await page.waitForFunction(()=>document.querySelector('#stage').classList.contains('is3d'),{timeout:30000});
 await page.locator('#view3d canvas').waitFor({state:'visible',timeout:25000});
 await page.waitForTimeout(3200);
 await page.screenshot({path:'screenshots/plan-3d.png',fullPage:true});
 console.log('✓ 3D canvas is visible');
 assert.equal(errs.length,0,'浏览器错误：'+errs.join('; ').slice(0,1200));
}finally{
 await browser.close();
}
