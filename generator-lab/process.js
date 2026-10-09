(function(root){
'use strict';
const names={entryway:'玄关',living_room:'客厅',dining_room:'餐厅',kitchen:'厨房',bedroom:'卧室',bathroom:'卫生间',corridor:'走道',stairs:'楼梯',utility:'家政空间',balcony:'阳台',multi_purpose:'多功能室'};
const modes={central:'楼梯居中',edge:'楼梯靠边',split:'分层组团'};
const rules={R1:'空间全部填满，每个小体块都有明确的功能和房间归属',R2:'尺寸与边界按 30 厘米对齐',R3:'上下层楼梯位置对齐并连续贯通',R4:'固定两层，每层高 3 米',R5:'使用 30 × 30 × 30 厘米的小体块',R6:'每个房间连成整体，形状为矩形或 L 型；走道还允许工字型'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function room(key,plan){const r=plan?.rooms?.find(r=>r.key===key);if(!r)return '相关空间';const peers=plan.rooms.filter(p=>p.type===r.type);return (names[r.type]||'空间')+(peers.length>1?' '+(peers.findIndex(p=>p.key===key)+1):'')+'（'+r.floor+'层）';}
function facts(plan,c){return '生成范围 '+c.length/1000+' × '+c.width/1000+' 米，两层，每层 3 米；'+c.bedrooms+' 间卧室、'+c.bathrooms+' 间卫生间。采用'+(modes[plan.mode]||'已确认的组织方式')+'，先安排公共联系空间，再分配各个房间。房间面积是目标偏好，实际面积会随分区调整。';}
function issue(i,plan){const who=Array.isArray(i.instance)?i.instance.map(k=>room(k,plan)).join('、'):room(i.instance,plan);
 if(i.code==='room_band_capacity')return who+'在当前分区中放不下：可用宽度或面积不足以满足最小要求。';
 if(i.code==='partition_capacity')return '当前分区方式尚未找到容纳全部房间的方案。';
 if(i.code==='missing_contact')return who+'未能按要求共用一段边界。';
 if(i.code==='components')return who+'被分成了不相连的部分，需要重新整理。';
 if(i.code==='shape'||i.code==='non_prismatic')return who+'的形状过于复杂，或上下体块不一致。';
 if(i.code==='stairs_alignment'||i.code==='stairs_count')return '楼梯未能保持唯一、上下对齐并连续贯通。';
 if(i.rule&&rules[i.rule])return '尚未满足：'+rules[i.rule]+'。';
 if(/area/i.test(i.code||''))return who+'未达到最低面积要求。';
 return '当前候选仍有空间分配条件未满足，需要重新尝试。';
}
function checks(data){return '<ul class="process-checks">'+(data?.checks||[]).map(c=>'<li>'+ (c.passed?'✓ ':'待调整 · ')+esc(rules[c.name]||'空间条件检查')+'</li>').join('')+'</ul>';}
function explanation(plan){return typeof plan?.design_summary==='string'?plan.design_summary.trim().slice(0,600):'';}
function entry(h){let title='',lines=[],extra='';
 if(h.outcome==='start'){title='需求与布局安排';lines=[facts(h.plan,h.conditions)];const summary=explanation(h.plan);if(summary)lines.push('大模型设计说明：'+summary);else lines.push('以上为系统根据已确认方案整理的说明。');}
 if(h.outcome==='progress'){title='生成器正在执行';lines=[h.text];}
 if(h.outcome==='search_exhausted'){title='本轮需要调整';lines=[...new Set((h.report?.issues||[]).slice(0,6).map(i=>issue(i,h.plan))),'本轮有限次数的尝试尚未找到合格布局，不代表这些需求一定无法实现。'];}
 if(h.outcome==='revising'){title='等待大模型调整';lines=['已把实际失败原因反馈给大模型；房间数量、楼层和必须相邻的关系继续保持。'];}
 if(h.outcome==='revision'){title='大模型已返回调整方案';const m=h.changes?.mode;if(m&&m.before!==m.after)lines.push('组织方式从'+(modes[m.before]||m.before)+'调整为'+(modes[m.after]||m.after)+'。');for(const a of h.changes?.areas||[])lines.push(room(a.key,h.plan)+'目标面积从 '+a.before+' 调整为 '+a.after+' 平方米。');for(const e of h.changes?.preferredAdded||[])lines.push('新增优先相邻偏好：'+room(e.a,h.plan)+'与'+room(e.b,h.plan)+'。');for(const e of h.changes?.preferredRemoved||[])lines.push('取消优先相邻偏好：'+room(e.a,h.plan)+'与'+room(e.b,h.plan)+'。');if(!lines.length)lines.push('房间组织方式、目标面积和相邻偏好保持不变，继续按返回的策略尝试。');const summary=explanation(h.plan);if(summary)lines.push('大模型调整说明：'+summary);lines.push('这只是调整建议，接下来仍由生成器重新计算和检查。');}
 if(h.outcome==='accepted'){title='空间检查完成';lines=['已找到满足本阶段空间条件的布局；必需相邻关系和最低面积也已检查。'];extra=checks(h.rules);if(h.areas?.length)extra+='<details><summary>查看目标面积与实际面积</summary><ul>'+h.areas.map(a=>'<li>'+esc(room(a.key,h.plan))+'：目标 '+esc(a.target)+' ㎡，实际 '+esc(a.actual)+' ㎡</li>').join('')+'</ul></details>';lines.push('这些检查不包含门窗、真实通行路径、采光、结构或完整建筑规范验收。');}
 if(h.outcome==='stopped'){title='本次生成已结束';lines=[h.text];}
 return '<article class="process-step"><strong>第 '+((h.round||0)+1)+' 轮 · '+esc(title)+'</strong>'+lines.map(t=>'<p>'+esc(t)+'</p>').join('')+extra+'</article>';
}
function render(history){return '<p class="muted">展示设计说明与实际执行记录，不是模型内部思维链。</p>'+history.map(entry).join('');}
const api={render,entry,facts,issue,checks};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DesignProcess=api;
})(globalThis);
