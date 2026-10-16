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
const a=app.indexOf('const SOURCE_TRACE = '),b=app.indexOf('const MATS = ',a);
assert.ok(a>=0&&b>a,'找不到户型数组');
const {SOURCE_TRACE,CANDIDATE_GROUPS,WALLS,WINS,DOORS,SLIDES,ROOMS,traceRect}=vm.runInNewContext(
 app.slice(a,b)+'\n({SOURCE_TRACE,CANDIDATE_GROUPS,WALLS,WINS,DOORS,SLIDES,ROOMS,traceRect})',
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
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<0.11,message+': '+actual+' / '+expected);
const same=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);
const rectPoly=r=>[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]];
const validRect=(r,message)=>assert.ok(r.slice(0,4).every(Number.isFinite)&&r[0]<r[2]&&r[1]<r[3],message);
assert.equal(SOURCE_TRACE.approximate,true,'图像拟合必须明确标为近似');
assert.ok(SOURCE_TRACE.revision,'缺少图像几何版本');
assert.ok(SOURCE_TRACE.mmPerPixel>0,'图像比例必须为正数');
const chains={
 north:['2887','3156','1572','2883'],south:['2887',null,'1912',null,'3118','1397'],
 west:[null,null,'1694','1436',null,'3651','1483'],east:['2794','2925','3651','1483']
};
same(SOURCE_TRACE.dimensionChains.map(c=>c.id).sort(),Object.keys(chains).sort(),'原图四边尺寸链');
for(const chain of SOURCE_TRACE.dimensionChains){
 same(chain.values,chains[chain.id],'原图印刷尺寸（空白段不得补造） '+chain.id);
 assert.equal(chain.anchors.length,chain.values.length+1,'尺寸链端点数量 '+chain.id);
 assert.ok(chain.anchors.every((n,i)=>Number.isFinite(n)&&(!i||n>chain.anchors[i-1])),'尺寸链端点顺序 '+chain.id);
 assert.equal(chain.axis,['north','south'].includes(chain.id)?'x':'y','尺寸链方向 '+chain.id);
}
const south=SOURCE_TRACE.dimensionChains.find(c=>c.id==='south');
same(south.anchors,[124,335,359,503,584,814,920],'底边两段未标尺寸跨度的位置');
same(south.ticks,[124,335,359,499,507,584,812,816,920],'底边墙厚双刻度必须保留');
same(south.labelSpans,[[124,335],[335,359],[359,499],[507,584],[584,812],[816,920]],'底边尺寸文字使用原图墙面基线');
console.log('✓ 四边原始尺寸链与未标注空段保留，拟合坐标标明近似');
assert.equal(ROOMS.length,7);
assert.equal(DOORS.length,5);assert.equal(WINS.length,8);assert.equal(SLIDES.length,1);
for(const [id,name] of Object.entries({public:'客厅',kitchen:'厨房',bath:'卫生间',bedA:'卧室A',bedB:'卧室B',balcony:'阳台'}))
 assert.equal(ROOMS.find(r=>r.id===id)?.name,name,'原图房名 '+id);
for(const [id,sz] of Object.entries({public:'28.2',kitchen:'4.9',bedA:'8.1',bedB:'11.4',balcony:'4.6'}))
 assert.equal(ROOMS.find(r=>r.id===id)?.labelArea,sz,'原图面积 '+id);
for(const id of ['bath','dry']) assert.equal(ROOMS.find(r=>r.id===id)?.labelArea,null);
assert.equal(ROOMS.find(r=>r.id==='dry').at,null,'干区不得添加原图没有的房间文字');
assert.equal(ROOMS.filter(r=>r.at).length,6,'原图只有六个房名');
assert.ok(ROOMS.find(r=>r.id==='public').poly.length>=16,'客厅须保留入口及干区的凹凸折点');
// Independently transcribed window landmarks from the supplied 1042×1279 photo.
// In particular the east balcony window is a separate eighth opening.
const sourceWindows=[
 [179,402,250,420],[403,320,506,339],[622,262,698,281],[765,262,877,281],
 [919,611,938,709],[831,709,919,727],[812,995,831,1047],[626,1103,789,1121]
];
sourceWindows.forEach((r,i)=>traceRect(r).forEach((n,j)=>near(WINS[i][j],n,'原图窗洞 '+i)));
const approved={
 kitchen:[[335,420,345,489],[335,539,345,543]],
 bathroomSouth:[[585,402,648,411],[585,518,638,527]],
 foyer:[[498,557,508,649]],
 bedroomBNorth:[[585,709,593,719],[651,709,814,719]]
};
same(Object.keys(CANDIDATE_GROUPS).sort(),Object.keys(approved).sort(),'仅有用户指定的四组候选墙');
for(const [group,sourceRects] of Object.entries(approved)){
 const matches=WALLS.filter(w=>w[4]==='n'&&w[5]===group);
 assert.equal(matches.length,sourceRects.length,'候选墙段数量 '+group);
 sourceRects.forEach(r=>assert.ok(matches.some(w=>traceRect(r).every((n,j)=>Math.abs(n-w[j])<0.11)),'候选墙范围 '+group));
}
for(const [i,w] of WALLS.entries()){
 validRect(w,'墙尺寸 '+i);
 assert.ok(['b','n'].includes(w[4]),'墙必须为受保护或明确指定候选 '+i);
 assert.equal(w[4]==='n',Object.hasOwn(approved,w[5]),'其他所有墙必须受保护 '+i);
}
assert.equal(WALLS.filter(w=>w[4]==='n').length,7,'四组候选墙共七段，其余受保护');
for(const room of ROOMS){
 assert.ok(room.poly.length>=4,'房间多边形 '+room.id);
 if(room.at) assert.ok(pin(room.at,room.poly),'房名需位于所属房间 '+room.id);
 room.poly.forEach((p,i)=>{
  assert.ok(p.length===2&&p.every(Number.isFinite),'房间坐标 '+room.id);
  const q=room.poly[(i+1)%room.poly.length];
  assert.ok((p[0]===q[0])!==(p[1]===q[1]),'房间须为无零长边的正交轮廓 '+room.id);
 });
 WALLS.forEach((w,i)=>assert.ok(polyInt(room.poly,rectPoly(w))<0.1,'地面穿墙 '+room.id+'/'+i));
}
for(let i=0;i<ROOMS.length;i++)for(let j=i+1;j<ROOMS.length;j++)
 assert.ok(polyInt(ROOMS[i].poly,ROOMS[j].poly)<0.1,'地面重叠：'+ROOMS[i].id+'/'+ROOMS[j].id);
console.log('✓ 六个原图标签、八扇窗及四组候选墙；房间无重叠或穿墙');
for(const d of DOORS){
 validRect(d.rect,d.name+' 洞口');
 near(d.len,Math.max(d.rect[2]-d.rect[0],d.rect[3]-d.rect[1]),d.name+' 洞口宽不符');
 const horizontal=d.rect[2]-d.rect[0]>d.rect[3]-d.rect[1],a=horizontal?0:1;
 assert.ok([d.rect[a],d.rect[a+2]].some(n=>Math.abs(n-d.h[a])<0.11),d.name+' 合页须在洞口端面');
 assert.ok(d.h[1-a]>=d.rect[1-a]&&d.h[1-a]<=d.rect[3-a],d.name+' 合页须在墙厚内');
 near(Math.hypot(...d.c),1,d.name+' 关门方向');near(Math.hypot(...d.o),1,d.name+' 开门方向');
 near(d.c[0]*d.o[0]+d.c[1]*d.o[1],0,d.name+' 门扇转角');
 const closed=d.h.map((n,i)=>n+d.c[i]*d.len);
 assert.ok(closed.every((n,i)=>n>=d.rect[i]-0.11&&n<=d.rect[i+2]+0.11),d.name+' 关闭门扇必须覆盖洞口');
 WALLS.forEach((w,i)=>assert.ok(rectInt(d.rect,w)<0.1,d.name+' 遇墙 '+i));
}
for(const [name,arr] of [['窗',WINS],['推拉门',SLIDES.map(x=>x.rect)]])
 arr.forEach((rect,j)=>{
  validRect(rect,name+j+' 尺寸');
  WALLS.forEach((w,i)=>assert.ok(rectInt(rect,w)<0.1,name+j+' 遇墙 '+i));
 });
console.log('✓ 门窗洞口与墙体不重叠');
const fa=app.indexOf('function defaultFurniture(){ return [');
const fb=app.indexOf('function defaultState(){',fa);
const furniture=[...app.slice(fa,fb).matchAll(
 /F\('([^']+)','([^']+)',(\d+),(\d+),(\d+),(\d+)(?:,(\d+))?/g
)].map(m=>({name:m[2],cx:+m[3],cy:+m[4],w:+m[5],d:+m[6],rot:+(m[7]||0)}));
assert.ok(furniture.length>=20);
const furnitureCollisions=[];
for(const f of furniture){
 const a=f.rot*Math.PI/180,hw=(Math.abs(Math.cos(a))*f.w+Math.abs(Math.sin(a))*f.d)/2,
 hh=(Math.abs(Math.sin(a))*f.w+Math.abs(Math.cos(a))*f.d)/2;
 const r=[f.cx-hw,f.cy-hh,f.cx+hw,f.cy+hh];
 WALLS.forEach((w,i)=>{if(rectInt(r,w)>=0.01) furnitureCollisions.push(f.name+' / 墙 '+i);});
}
assert.equal(furnitureCollisions.length,0,'家具穿墙：'+furnitureCollisions.join('；'));
// Exercise real import/load normalization, including a stale geometry revision.
const fixStart=app.indexOf('function fixState(s){'),fixEnd=app.indexOf('const PX_MM',fixStart);
assert.ok(fixStart>=0&&fixEnd>fixStart,'找不到方案导入校验');
const normalize=vm.runInNewContext(
 app.slice(a,b)+'\nfunction defaultState(){return {geometryVersion:SOURCE_TRACE.revision,rooms:{},furniture:[],demolished:[],measures:[]};}\n'+
 app.slice(fixStart,fixEnd)+'\nfixState',Object.create(null),{timeout:2000});
const candidate='w'+WALLS.findIndex(w=>w[4]==='n');
const badIds=WALLS.map((_,i)=>'w'+i).concat([candidate,null,{},'w-1','w9999','w01',3]);
const expected=WALLS.flatMap((w,i)=>w[4]==='n'?['w'+i]:[]);
same(normalize({geometryVersion:SOURCE_TRACE.revision,furniture:[],demolished:badIds}).demolished,expected,'导入仅保留唯一合法候选墙');
same(normalize({geometryVersion:SOURCE_TRACE.revision,furniture:[],demolished:{}}).demolished,[],'非数组拆墙记录');
same(normalize({geometryVersion:'older-plan',furniture:[],demolished:[candidate]}).demolished,[],'旧几何索引必须丢弃');
same(normalize({furniture:[],demolished:[candidate]}).demolished,[],'无几何版本的拆墙记录必须丢弃');
console.log('✓ 家具 '+furniture.length+' 件无穿墙；导入、存档及旧版本拆墙保护通过');
console.log('通过静态几何测试；尚需真实浏览器2D/3D视觉核验及现场复尺。');
