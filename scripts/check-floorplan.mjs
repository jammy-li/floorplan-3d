import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

// 仅做代码语法/几何自洽检查；不是浏览器可视化、真实测绘或施工审图。
// 运行：node scripts/check-floorplan.mjs
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const app=scripts.find(([,a])=>a.trim()==='')?.[2];
const scene=scripts.find(([,a])=>/type\s*=\s*["']module["']/.test(a))?.[2];
assert.ok(app&&scene,'主脚本或3D模块缺失');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'floorplan-test-'));
try {
 for(const [n,src] of [['app.js',app],['scene.mjs',scene]]){
  const p=path.join(tmp,n);fs.writeFileSync(p,src);
  execFileSync(process.execPath,['--check',p],{stdio:'pipe'});
  console.log('✓ 脚本语法',n);
 }
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
const a=app.indexOf('const WALLS = ['),b=app.indexOf('const MATS = ',a);
assert.ok(a>=0&&b>a,'找不到户型数组');
const {WALLS,WINS,DOORS,SLIDES,ROOMS}=vm.runInNewContext(
 app.slice(a,b)+'\n({WALLS,WINS,DOORS,SLIDES,ROOMS})',
 Object.create(null),{timeout:2000}
);
const rectInt=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*
 Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
const pin=([x,y],p)=>{
 let v=false;
 for(let i=0,j=p.length-1;i<p.length;j=i++){
  const a=p[i],b=p[j];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])v=!v;
 }
 return v;
};
const uniq=a=>[...new Set(a)].sort((x,y)=>x-y);
const polyInt=(a,b)=>{
 const xs=uniq([...a,...b].map(p=>p[0])),ys=uniq([...a,...b].map(p=>p[1]));
 let total=0;
 for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){
  const pt=[(xs[i]+xs[i-1])/2,(ys[j]+ys[j-1])/2];
  if(pin(pt,a)&&pin(pt,b))total+=(xs[i]-xs[i-1])*(ys[j]-ys[j-1]);
 }
 return total;
};
assert.equal(ROOMS.length,7);
assert.equal(DOORS.length,5);assert.equal(WINS.length,7);assert.equal(SLIDES.length,1);
for(const [id,sz] of Object.entries({public:'28.2',kitchen:'4.9',bedA:'8.1',bedB:'11.4',balcony:'4.6'}))
 assert.equal(ROOMS.find(r=>r.id===id)?.labelArea,sz,'原图面积 '+id);
for(const id of ['bath','dry']) assert.equal(ROOMS.find(r=>r.id===id)?.labelArea,null);
const kitchen=ROOMS.find(r=>r.id==='kitchen');
assert.equal(Math.max(...kitchen.poly.map(p=>p[1]))-Math.min(...kitchen.poly.map(p=>p[1])),1694);
for(const [i,w] of WALLS.entries()){
 assert.ok(w[0]<w[2]&&w[1]<w[3],'墙尺寸 '+i);
 assert.ok(['b','e','n','low'].includes(w[4]),'墙类型 '+i);
}
for(let i=0;i<ROOMS.length;i++)for(let j=i+1;j<ROOMS.length;j++)
 assert.equal(polyInt(ROOMS[i].poly,ROOMS[j].poly),0,'地面重叠：'+ROOMS[i].id+'/'+ROOMS[j].id);
console.log('✓ 房间没有地面重叠');
for(const d of DOORS){
 assert.equal(d.len,Math.max(d.rect[2]-d.rect[0],d.rect[3]-d.rect[1]),d.name+' 洞口宽不符');
 assert.ok([d.rect[0],d.rect[2]].includes(d.h[0])&&[d.rect[1],d.rect[3]].includes(d.h[1]),d.name+' 合页位置');
 WALLS.forEach((w,i)=>assert.equal(rectInt(d.rect,w),0,d.name+' 遇墙 '+i));
}
for(const [name,arr] of [['窗',WINS],['推拉门',SLIDES.map(x=>x.rect)]])
 arr.forEach((rect,j)=>WALLS.forEach((w,i)=>assert.equal(rectInt(rect,w),0,name+j+' 遇墙 '+i)));
console.log('✓ 门窗洞口与墙体不重叠');
const fa=app.indexOf('function defaultFurniture(){ return [');
const fb=app.indexOf('function defaultState(){',fa);
const furniture=[...app.slice(fa,fb).matchAll(
 /F\('([^']+)','([^']+)',(\d+),(\d+),(\d+),(\d+)(?:,(\d+))?/g
)].map(m=>({name:m[2],cx:+m[3],cy:+m[4],w:+m[5],d:+m[6],rot:+(m[7]||0)}));
assert.ok(furniture.length>=20);
for(const f of furniture){
 const a=f.rot*Math.PI/180,hw=(Math.abs(Math.cos(a))*f.w+Math.abs(Math.sin(a))*f.d)/2,
 hh=(Math.abs(Math.sin(a))*f.w+Math.abs(Math.cos(a))*f.d)/2;
 const r=[f.cx-hw,f.cy-hh,f.cx+hw,f.cy+hh];
 WALLS.forEach((w,i)=>assert.ok(rectInt(r,w)<0.01,'家具 '+f.name+' 穿墙 '+i));
}
assert.ok(app.includes("if (w[4]!=='n')"),'拆墙必须仅允许标红的 n');
console.log('✓ 家具 '+furniture.length+' 件无穿墙，拆墙权限已锁定');
console.log('通过静态几何测试；尚需真实浏览器2D/3D视觉核验及现场复尺。');
