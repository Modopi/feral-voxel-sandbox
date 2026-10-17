import {asset,mat,part,paint as box,anchor,rng} from './shared.mjs';

// Visual authoring coordinates only. finish() fits the entire silhouette to the
// species L/W/H, then snaps world boundaries and pivots to the art grid.
// The geometry is deliberately independent of combat, collision and anatomy HP.
class Shape {
  constructor(e){this.e=e;this.parts=[{id:'root',parent:null,p:[0,0,0],role:'root',boxes:[]}];this.anchors=[];this.random=rng(e.id);}
  part(id,p=[0,0,0],parent='root',role='visual'){this.parts.push({id,parent,p,role,boxes:[]});return id;}
  b(id,c,s,m='coat'){this.parts.find(p=>p.id===id).boxes.push({c,s,m});}
  a(id,p,pos,purpose){this.anchors.push({id,p,pos,purpose});}
}
const palettes={
 moss_deer:['#648570','#B8B78B','#355449','#E7D7A0'],copper_fox:['#B86636','#E7C694','#542E32','#ED9B56'],azure_beetle:['#26617B','#83ADAE','#17394D','#DAB969'],root_stalker:['#414C39','#8B8C61','#262C2A','#A89855'],
 scree_hare:['#8D8273','#CFBF9F','#51494B','#C57A67'],flint_jackal:['#706C62','#D0BA8A','#302E34','#D1A45A'],ore_mite:['#9A7656','#DCC28B','#503D3A','#8CC5B0'],shaft_weasel:['#735645','#D5B590','#392F32','#B37B53'],
 reed_grazer:['#6B7962','#B8AA76','#384B49','#A9B966'],mud_croc:['#496054','#85906A','#243D39','#C2A960'],silt_snail:['#6E8D72','#D3B68B','#344A45','#97D294'],drain_eel:['#344E62','#9CB4AA','#1E2D41','#B7DC8F'],
 ash_goat:['#827D73','#C6BBA0','#34373B','#C78E53'],ember_lizard:['#67473D','#BFA25E','#282C32','#EE873E'],vent_grub:['#B4A48A','#EEE0B9','#65554D','#D48C58'],furnace_mantis:['#8B6450','#C8A876','#343B3C','#EF9B4A'],
 cliff_ibex:['#92836D','#DBD1B3','#4C4950','#A6C3C8'],gale_raptor:['#537183','#DACAA4','#283B51','#ADCCD0'],tide_crab:['#596E7B','#CDBA94','#2D404B','#C87D5D'],cistern_serpent:['#3F6B6A','#BFC4A0','#233E48','#D2AD67'],
 prism_deer:['#75A5A0','#D0E0C2','#416476','#A6DEE0'],veil_cat:['#57647F','#B9B6CB','#30364E','#91B9D2'],mana_moth:['#7973A9','#D5C9DD','#403D68','#A6DCCB'],root_weaver:['#695A7A','#BFB59B','#39384B','#9BC4A4'],
 candle_hare:['#C1B58C','#F1E5BD','#786450','#E9CD7D'],relic_hound:['#756A68','#D6C5A2','#353B49','#D2AC64'],shrine_beetle:['#756A54','#D2BB85','#41464D','#DBCA83'],oath_sentinel:['#828D94','#DBCBA9','#35434C','#D6B36C'],
 drift_grazer:['#7C8994','#C0CABD','#3F4A60','#9DC9D1'],phase_stalker:['#505775','#A1AAC2','#2A3046','#A7C4DC'],anchor_tick:['#626D7D','#B2B2A0','#333B4E','#B7A277'],survey_drone:['#8C9FA4','#DBD7BF','#35485A','#8ED1D3'],
 wayfarer_organic:['#637A70','#D3AC8C','#394449','#C1A471'],custodian_inorganic:['#6D8D8B','#C9C5AA','#36494D','#D0A26B']
};
function head(s,id,p,size,{parent='root',muzzle=.25,ears=.2,predator=false,eye='ink',broad=false}={}){
 s.part(id,p,parent,'head_visual');s.b(id,[0,0,0],size);s.b(id,[0,-size[1]*.16,size[2]*.44],[size[0]*(broad?.85:.65),size[1]*.48,muzzle],'belly');
 s.b(id,[0,-size[1]*.13,size[2]*.44+muzzle*.49],[size[0]*.4,size[1]*.19,.055],'dark');
 for(const sign of [-1,1]){s.b(id,[sign*size[0]*.43,size[1]*.15,size[2]*.38],[.065,.06,.065],'ivory');s.b(id,[sign*size[0]*.45,size[1]*.15,size[2]*.43],[.037,.043,.035],eye);
 if(ears){let ep=s.part(id+'_ear_'+(sign<0?'l':'r'),[sign*size[0]*.38,size[1]*.42,-size[2]*.16],id,'ear_visual');s.b(ep,[0,ears*.45,0],[size[0]*.26,ears,.10]);s.b(ep,[0,ears*.5,.055],[size[0]*.12,ears*.6,.025],'belly');}
 if(predator)for(let z=0;z<3;z++)s.b(id,[sign*size[0]*.24,-size[1]*.34,size[2]*.4+z*.055],[.035,.055,.035],'ivory');}
 s.a(id+'_look',id,[0,0,size[2]*.55+muzzle*.5],'front-facing head animation locator; visual only');
 return id;
}
function leg(s,id,p,{length=.55,width=.12,hoof=true,back=false,parent='root'}={}){
 s.part(id,p,parent,'limb_visual');s.b(id,[0,-length*.28,back?-.035:.015],[width*1.25,length*.56,width*1.3]);s.b(id,[0,-length*.7,back?.025:0],[width*.75,length*.48,width*.85],'coat');
 s.b(id,[0,-length*.96,.055],[width*1.25,length*.12,width*1.8],hoof?'dark':'belly');s.a(id+'_contact',id,[0,-length,0],'foot placement visual locator; not collision');
}
function tail(s,id,p,{steps=6,length=.6,width=.13,curve=.1,fluffy=false,tip='belly'}={}){
 s.part(id,p,'root','tail_visual');for(let i=0;i<steps;i++){const t=i/(steps-1);s.b(id,[0,t*curve,-t*length],[width*(fluffy?1.4-.8*t:1-.6*t),width*(fluffy?1.5-.9*t:1-.6*t),length/steps*1.4],i>steps-3?tip:'coat');}
}
function horn(s,id,p,{height=.5,spread=.18,back=.1,branch=false,sign=1,material='ivory',curl=false}={}){
 s.part(id,p,'root','horn_visual');for(let i=0;i<6;i++){let t=i/5;s.b(id,[sign*t*spread,t*height,-t*back],[.07-.025*t,.12,.08],material);
 if(branch&&i>1&&i<5){s.b(id,[sign*(t*spread+.10),t*height+.025,-t*back+.06],[.18,.055,.055],material);s.b(id,[sign*(t*spread+.17),t*height+.09,-t*back+.06],[.045,.13,.045],material);}}
 if(curl){for(let i=0;i<3;i++)s.b(id,[sign*(spread-.025*i),height-.07*i,-back-.08*(i+1)],[.075,.09,.13],material);}
}
function quadruped(s,kind){
 const small=['fox','hare','weasel'].includes(kind),low=['stalker','lizard','croc'].includes(kind),cat=['cat','phase'].includes(kind);
 const bodyY=low?.48:small?.65:.92,bodyW=kind==='reed'?.67:kind==='drift'?.65:kind==='croc'?.63:cat?.48:.43;
 const bodyL=kind==='weasel'?1.2:kind==='croc'?1.5:kind==='lizard'?1.1:.95;
 s.part('thorax',[0,bodyY,0],'root','torso_visual');s.b('thorax',[0,0,0],[bodyW,.4,bodyL]);s.b('thorax',[0,-.15,.04],[bodyW*.86,.17,bodyL*.85],'belly');s.b('thorax',[0,.15,-.06],[bodyW*.8,.17,bodyL*.77]);
 const hY=low?bodyY+.04:kind==='hare'?bodyY+.27:bodyY+.29,hZ=bodyL*.5+.13;
 if(!low){s.part('neck',[0,bodyY+.18,bodyL*.38],'root','neck_visual');s.b('neck',[0,.08,.03],[bodyW*.65,.43,.27]);}
 head(s,'head',[0,hY,hZ],[bodyW*.75,low?.22:.3,low?.37:.31],{muzzle:kind==='croc'?.55:kind==='weasel'?.15:.24,ears:low?0:kind==='hare'?.56:kind==='fox'?.3:.17,predator:['fox','jackal','weasel','stalker','cat','phase','hound','lizard','croc'].includes(kind),broad:kind==='croc'});
 const l=bodyY-.10;for(const side of [-1,1])for(const front of [false,true])leg(s,(side<0?'left':'right')+(front?'_foreleg':'_hindleg'),[side*bodyW*.42,bodyY-.08,(front?1:-1)*bodyL*.35],{length:l,width:kind==='reed'||kind==='drift'?.17:kind==='hare'&&!front?.18:.12,hoof:['deer','goat','ibex','reed','drift'].includes(kind),back:!front});
 tail(s,'tail',[0,bodyY,-bodyL*.5],{length:kind==='croc'?.95:kind==='weasel'?.7:cat?.85:kind==='hare'?.16:.48,width:kind==='croc'?.3:kind==='fox'?.23:.13,fluffy:kind==='fox',curve:cat?.3:kind==='croc'?-.15:.1});
 s.a('body_center','thorax',[0,0,0],'visual centre for animation and preview');
 if(kind==='deer'||kind==='drift')for(const sign of [-1,1])horn(s,'antler_'+sign,[sign*.12,hY+.13,hZ-.02],{height:kind==='drift'?.3:.47,spread:.21,back:.04,branch:true,sign,material:kind==='drift'?'accent':'ivory'});
 if(kind==='goat'||kind==='ibex')for(const sign of [-1,1])horn(s,'horn_'+sign,[sign*.13,hY+.11,hZ-.03],{height:kind==='ibex'?.58:.34,spread:.1,back:kind==='ibex'?.42:.23,sign,curl:true,material:'dark'});
 if(kind==='goat'||kind==='ibex'){s.part('beard',[0,hY-.15,hZ+.1]);for(let i=0;i<3;i++)s.b('beard',[0,-i*.07,0],[.13-i*.025,.12,.10],'belly');}
 if(kind==='hare'){s.b('thorax',[0,.02,-.32],[bodyW*1.16,.45,.38]);s.b('tail',[0,.02,-.02],[.22,.22,.21],'belly');}
 if(kind==='fox'){s.b('thorax',[0,.12,.34],[.48,.44,.26],'belly');for(const side of [-1,1])s.b('head',[side*.15,-.06,.06],[.14,.16,.21],'belly');}
 if(kind==='jackal'){for(let i=0;i<7;i++)s.b('thorax',[0,.245,-.36+i*.12],[.30,.045,.09],'dark');s.b('head',[0,.17,-.04],[.16,.08,.16],'dark');}
 if(kind==='weasel'){s.b('neck',[0,-.05,.12],[.24,.25,.09],'belly');for(const side of [-1,1])s.b('head',[side*.18,-.035,.15],[.15,.025,.025],'ivory');}
 if(kind==='stalker'){s.part('root_shoulder_growth',[0,bodyY+.2,-.05]);for(let i=0;i<9;i++)s.b('root_shoulder_growth',[(i%3-1)*.13,Math.floor(i/3)*.06,(i%2)*.14-.18],[.1,.17,.18],i%2?'accent':'dark');s.b('head',[0,-.08,.32],[.18,.07,.18],'accent');}
 if(kind==='reed'){s.part('reed_back',[0,bodyY+.2,-.1]);for(let i=0;i<7;i++){const x=(i%3-1)*.15,z=Math.floor(i/3)*.18-.2;s.b('reed_back',[x,.17+(i%2)*.05,z],[.055,.33+(i%2)*.1,.06],'accent');s.b('reed_back',[x+.05,.25,z],[.12,.055,.09],'belly');}for(const side of [-1,1])s.b('head',[side*.13,.14,.12],[.12,.12,.13],'dark');}
 if(kind==='croc'){s.b('head',[0,.02,.38],[.35,.13,.6]);for(const side of [-1,1])for(let i=0;i<6;i++)s.b('head',[side*.17,-.06,.16+i*.08],[.035,.07,.035],'ivory');s.part('dorsal_scutes',[0,bodyY+.22,0]);for(let i=0;i<8;i++)for(const side of [-1,1])s.b('dorsal_scutes',[side*.17,.015,-.65+i*.17],[.13,.12,.12],'dark');}
 if(kind==='lizard'){s.part('heat_pouch',[0,bodyY-.06,bodyL*.45]);s.b('heat_pouch',[0,0,.08],[.33,.3,.24],'accent');for(let i=0;i<8;i++)s.b('thorax',[0,.27,-.48+i*.14],[.10,.16,.10],'dark');}
 if(cat){for(let j=0;j<7;j++)for(const sign of [-1,1])s.b('thorax',[sign*(bodyW*.5+.005),.05-(j%2)*.08,-.4+j*.13],[.035,.20,.045],kind==='phase'?'accent':'dark');if(kind==='phase'){s.b('head',[0,.17,0],[.12,.05,.25],'accent');for(let i=0;i<4;i++)s.b('tail',[0,.05,-i*.18],[.16,.035,.045],'accent');}}
 if(kind==='hound'){s.part('mane',[0,bodyY+.05,.34]);for(let i=0;i<5;i++)s.b('mane',[(i-2)*.105,.17-Math.abs(i-2)*.03,0],[.14,.37,.22],'belly');s.b('thorax',[0,.23,.12],[.07,.04,.5],'accent');for(const sign of [-1,1])s.b('thorax',[sign*bodyW*.51,.07,.1],[.035,.09,.33],'accent');}
 if(kind==='drift'){s.part('buoyancy_ridges',[0,bodyY+.18,0]);for(const sign of [-1,1])for(let i=0;i<4;i++)s.b('buoyancy_ridges',[sign*.24,.1+i*.02,-.35+i*.2],[.14,.16,.12],'accent');for(const sign of [-1,1])for(const front of [false,true])s.b((sign<0?'left':'right')+(front?'_foreleg':'_hindleg'),[0,-l+.04,.04],[.25,.12,.28],'dark');}
}
function beetle(s,kind){
 const mite=kind==='mite',tick=kind==='tick',crab=kind==='crab';
 s.part('carapace',[0,.32,0],'root','shell_visual');s.b('carapace',[0,0,0],[.68,.28,.75]);s.b('carapace',[0,.15,-.035],[.52,.12,.6]);s.b('carapace',[0,-.15,.04],[.55,.09,.63],'belly');
 s.part('head',[0,.26,.43],'root','head_visual');s.b('head',[0,0,0],[.4,.19,.25],'dark');
 for(const sign of [-1,1]){s.b('head',[sign*.14,.07,.12],[.06,.06,.06],'accent');
 const ant=s.part('antenna_'+sign,[sign*.14,.12,.08],'head','antenna_visual');for(let i=0;i<3;i++)s.b(ant,[sign*i*.07,i*.06,i*.07],[.04,.05,.12],i===2?'accent':'dark');
 for(let i=0;i<3;i++){const id=s.part('leg_'+sign+'_'+i,[sign*.29,.28,.25-i*.25],'root','limb_visual');s.b(id,[sign*.15,-.02,0],[.33,.065,.075],'dark');s.b(id,[sign*.28,-.12,.07*(i-1)],[.075,.25,.09]);s.b(id,[sign*.3,-.235,.08*(i-1)],[.13,.055,.12],tick?'accent':'dark');s.a(id+'_contact',id,[sign*.3,-.26,0],'visual contact locator');}
 if(crab){const p=s.part('claw_'+sign,[sign*.33,.32,.38],'root','pincer_visual');s.b(p,[sign*.13,0,.12],[.28,.12,.23]);s.b(p,[sign*.22,.02,.30],[.23,.21,.26],'accent');s.b(p,[sign*.16,.02,.48],[.08,.14,.22],'belly');s.b(p,[sign*.30,.02,.45],[.07,.14,.16],'belly');}}
 if(!mite&&!tick){s.b('carapace',[0,.218,-.04],[.035,.035,.59],'dark');for(const sign of [-1,1])for(let i=0;i<3;i++)s.b('carapace',[sign*.16,.22,-.2+i*.19],[.17,.035,.08],'accent');}
 if(mite){for(let i=0;i<18;i++){const x=(s.random()-.5)*.5,z=(s.random()-.5)*.5;s.b('carapace',[x,.23,z],[.055,.07,.055],i%3?'belly':'accent');}}
 if(tick){for(const sign of [-1,1])for(let i=0;i<3;i++)s.b('carapace',[sign*.30,.03,.23-i*.23],[.12,.22,.14],'accent');s.b('carapace',[0,.22,0],[.35,.07,.44],'dark');}
 if(kind==='shrine'){s.part('crest',[0,.55,.03]);s.b('crest',[0,0,0],[.09,.06,.58],'accent');s.b('crest',[0,0,.1],[.43,.06,.08],'accent');for(const sign of [-1,1])s.b('carapace',[sign*.28,.06,-.12],[.08,.2,.23],'belly');}
 s.a('shell_center','carapace',[0,.15,0],'visual shell inspection anchor');
}
function snail(s){
 s.part('foot',[0,.1,0],'root','foot_visual');for(let i=0;i<6;i++)s.b('foot',[0,.01,-.4+i*.17],[.5-Math.abs(i-2)*.04,.18,.20],'coat');
 s.part('shell',[0,.45,-.06],'root','shell_visual');for(let i=0;i<5;i++){const t=i/4;s.b('shell',[0,t*.045,-t*.035],[.52-t*.22,.6-t*.12,.66-t*.16],i%2?'belly':'dark');}
 for(const side of [-1,1]){for(let i=0;i<7;i++){const angle=i*.8,x=side*.27,y=Math.sin(angle)*(.23-i*.018),z=Math.cos(angle)*(.23-i*.018);s.b('shell',[x,y,z],[.04,.095,.095],'accent');}
 const id=s.part('eye_stalk_'+side,[side*.13,.2,.46],'root','eye_visual');s.b(id,[0,.13,0],[.055,.28,.055]);s.b(id,[0,.28,.01],[.09,.09,.09],'dark');s.b(id,[0,.285,.055],[.035,.035,.025],'accent');}
 s.part('mouth',[0,.14,.55]);s.b('mouth',[0,0,0],[.13,.055,.055],'dark');s.a('foot_contact','foot',[0,-.1,0],'visual ground locator');
}
function grub(s){
 for(let i=0;i<8;i++){const z=-.52+i*.15,y=.22+Math.sin(i*.6)*.04,w=.38-Math.abs(i-3)*.025,id=s.part('segment_'+i,[0,y,z],i?'root':'root','body_segment_visual');s.b(id,[0,0,0],[w,.32,.19]);s.b(id,[0,.17,0],[w*.85,.045,.05],'belly');for(const side of [-1,1]){s.b(id,[side*w*.35,-.15,.02],[.065,.11,.08],'dark');s.b(id,[side*w*.5,0,.02],[.035,.055,.045],'accent');}}
 head(s,'head',[0,.23,.7],[.25,.22,.19],{ears:0,muzzle:.06});s.a('head_forward','head',[0,0,.16],'visual crawling direction');
}
function serpent(s,eel=false){
 const n=12;for(let i=0;i<n;i++){const t=i/(n-1),x=Math.sin(t*Math.PI*1.3)*.26,y=.17+Math.sin(t*Math.PI)*.12,z=-.9+t*1.8,w=.16+Math.sin(t*Math.PI)*.15,id=s.part('segment_'+i,[x,y,z],'root','axial_segment_visual');s.b(id,[0,0,0],[w,w,.23]);s.b(id,[0,-w*.38,.02],[w*.8,.055,.19],'belly');if(i%2===0)s.b(id,[0,w*.51,0],[w*.8,.04,.05],'accent');if(eel&&i<10)s.b(id,[0,w*.6,0],[.045,.13,.18],'dark');}
 head(s,'head',[.20,.27,1.03],[.30,.23,.36],{ears:0,muzzle:.16,predator:true,broad:true,eye:'accent'});if(eel){for(const side of [-1,1])for(let i=0;i<3;i++)s.b('head',[side*.155,-.02,-.12+i*.05],[.035,.12,.025],'accent');}
 else{for(const side of [-1,1])s.b('head',[side*.14,.12,.05],[.09,.08,.22],'accent');s.part('tail_rattle',[0,.2,-1.02]);for(let i=0;i<3;i++)s.b('tail_rattle',[0,0,-i*.075],[.13-i*.025,.13-i*.025,.07],'belly');}
 s.a('strike_origin','head',[0,0,.3],'visual aiming locator; not attack shape');
}
function wings(s,moth=false){
 s.part('thorax',[0,.35,0],'root','torso_visual');s.b('thorax',[0,0,0],[moth?.18:.34,.3,moth?.55:.62]);s.b('thorax',[0,-.09,.04],[.2,.12,.45],'belly');
 for(const sign of [-1,1]){let id=s.part('wing_'+sign,[sign*.1,.44,-.04],'root','wing_visual');
 if(moth){for(let i=0;i<5;i++){const x=sign*(.15+i*.17),len=.7-i*.08;s.b(id,[x,0,.05-i*.03],[.21,.065,len],i%2?'belly':'coat');s.b(id,[x,.04,.18],[.08,.025,.14],'accent');}for(let i=0;i<3;i++)s.b(id,[sign*(.18+i*.14),-.06,-.4-i*.03],[.18,.05,.34-i*.04],'coat');s.b(id,[sign*.54,.045,.1],[.20,.025,.22],'dark');s.b(id,[sign*.54,.065,.1],[.10,.025,.11],'accent');}
 else{for(let i=0;i<7;i++){const x=sign*(.12+i*.15),z=-i*.065;s.b(id,[x,Math.max(0,.1-i*.02),z],[.2,.12,.55-i*.025],i<3?'coat':'dark');s.b(id,[x,.07,z+.12],[.12,.045,.19],'belly');s.b(id,[x,-.02,z-.27-i*.025],[.11,.06,.27],'dark');}}
 s.a('wing_tip_'+sign,id,[sign*(moth?.92:1.08),0,-.4],'visual wing-tip locator; lift not implemented');}
 head(s,'head',[0,.50,.38],[moth?.16:.24,.21,.21],{ears:0,muzzle:moth?.04:.12,eye:moth?'accent':'ink'});
 if(moth){for(const sign of [-1,1]){let id=s.part('feathery_antenna_'+sign,[sign*.055,.57,.46]);for(let i=0;i<4;i++){s.b(id,[sign*.025*i,i*.03,i*.06],[.025,.035,.09],'dark');s.b(id,[sign*.025*i+.03,i*.03,i*.06],[.08,.025,.025],'accent');}}for(let i=0;i<4;i++)s.b('thorax',[0,.02,-.24-i*.035],[.16-i*.022,.17-i*.02,.07],i%2?'accent':'coat');}
 else{s.b('head',[0,-.055,.23],[.11,.11,.15],'accent');s.b('head',[0,-.10,.28],[.07,.10,.07],'dark');for(const sign of [-1,1]){let p=s.part('talon_'+sign,[sign*.1,.2,.12]);s.b(p,[0,-.09,0],[.055,.23,.06],'accent');for(let i=0;i<3;i++)s.b(p,[(i-1)*.055,-.2,.06],[.04,.055,.18],'dark');}tail(s,'tail',[0,.35,-.36],{length:.45,width:.25,curve:-.05,tip:'belly'});}
 s.a('body_center','thorax',[0,0,0],'visual flying body locator');
}
function spider(s){
 s.part('abdomen',[0,.45,-.25],'root','abdomen_visual');s.b('abdomen',[0,0,0],[.62,.48,.64]);s.b('abdomen',[0,.23,-.06],[.43,.10,.42],'belly');s.part('thorax',[0,.35,.23]);s.b('thorax',[0,0,0],[.43,.28,.37],'dark');
 for(const sign of [-1,1])for(let i=0;i<4;i++){let id=s.part('leg_'+sign+'_'+i,[sign*.2,.35,.37-i*.18],'root','limb_visual');s.b(id,[sign*.2,.12,(i-1.5)*.08],[.43,.08,.09]);s.b(id,[sign*.42,.04,(i-1.5)*.14],[.09,.30,.09]);s.b(id,[sign*.46,-.2,(i-1.5)*.19],[.07,.25,.075],'dark');s.a(id+'_tip',id,[sign*.46,-.32,(i-1.5)*.19],'visual contact locator');}
 s.part('face',[0,.36,.46]);for(let i=0;i<4;i++)s.b('face',[(i-1.5)*.085,.04,.025],[.055,.055,.06],'accent');for(const sign of [-1,1])s.b('face',[sign*.1,-.09,.06],[.08,.2,.08],'ivory');s.part('spinneret',[0,.28,-.6]);s.b('spinneret',[0,0,0],[.22,.19,.15],'accent');s.a('silk_origin','spinneret',[0,0,-.1],'visual filament attachment only');
 for(let i=0;i<5;i++)s.b('abdomen',[(i%2?1:-1)*.17,.26,-.22+i*.1],[.1,.06,.07],'accent');
}
function mantis(s){
 s.part('abdomen',[0,.55,-.2]);s.b('abdomen',[0,0,0],[.3,.28,.7]);for(let i=0;i<5;i++)s.b('abdomen',[0,.15,-.46+i*.14],[.32,.045,.055],'belly');s.part('neck',[0,.8,.18]);s.b('neck',[0,0,0],[.16,.55,.2]);
 head(s,'head',[0,1.13,.26],[.38,.20,.23],{ears:0,muzzle:.08,predator:true,eye:'accent'});
 for(const sign of [-1,1]){for(let i=0;i<2;i++){let id=s.part('walking_leg_'+sign+'_'+i,[sign*.13,.5,-.07-i*.30]);s.b(id,[sign*.2,-.06,0],[.42,.065,.08]);s.b(id,[sign*.39,-.28,.06],[.07,.48,.09],'dark');}
 let id=s.part('raptorial_arm_'+sign,[sign*.15,.93,.19],'root','weapon_limb_visual');s.b(id,[sign*.19,-.12,.1],[.38,.10,.13]);s.b(id,[sign*.36,-.27,.12],[.11,.35,.15],'dark');s.b(id,[sign*.36,-.34,.35],[.09,.09,.49],'accent');for(let i=0;i<5;i++)s.b(id,[sign*.36,-.28,.19+i*.08],[.06,.11,.04],'ivory');s.a('claw_tip_'+sign,id,[sign*.36,-.3,.59],'visual attack attachment; no hitbox');}
 s.part('folded_wings',[0,.7,-.28]);for(const sign of [-1,1])s.b('folded_wings',[sign*.1,0,0],[.16,.055,.62],'dark');
}
function humanoid(s,robot=false,sentinel=false){
 s.part('pelvis',[0,.71,0]);s.b('pelvis',[0,0,0],[.4,.22,.28],'dark');s.part('torso',[0,1.03,0]);s.b('torso',[0,0,0],[.48,.52,.3]);s.b('torso',[0,.1,.17],[.37,.26,.07],robot?'belly':'coat');
 for(const sign of [-1,1]){leg(s,'leg_'+sign,[sign*.14,.67,0],{length:.65,width:.16,hoof:robot});let id=s.part('arm_'+sign,[sign*.32,1.22,0],'root','arm_visual');s.b(id,[0,-.16,0],[.16,.32,.2]);s.b(id,[0,-.40,.025],[.14,.23,.16],robot?'dark':'belly');s.b(id,[0,-.52,.055],[.16,.13,.16],robot?'belly':'accent');s.a('hand_'+sign,id,[0,-.57,.06],'visual held prop attachment');}
 head(s,'head',[0,1.47,.01],[.34,.34,.3],{ears:0,muzzle:robot?.03:.07});
 if(robot){s.b('head',[0,.015,.17],[.28,.10,.045],'dark');s.b('head',[0,.015,.20],[.18,.04,.03],'accent');s.part('chest_panel',[0,1.05,.20]);s.b('chest_panel',[0,0,0],[.24,.17,.04],'dark');s.b('chest_panel',[0,.01,.035],[.12,.055,.035],'accent');for(const sign of [-1,1])s.b('torso',[sign*.28,.17,0],[.17,.2,.37],'belly');
 if(sentinel){s.part('helmet_crest',[0,1.69,0]);s.b('helmet_crest',[0,.08,0],[.10,.21,.35],'accent');s.part('guard_staff',[.48,.72,.15]);s.b('guard_staff',[0,0,0],[.07,1.35,.075],'dark');s.b('guard_staff',[0,.63,0],[.22,.23,.16],'accent');s.part('tabard',[0,.7,.2]);s.b('tabard',[0,-.15,0],[.28,.5,.06],'belly');}
 else{s.part('tool_satchel',[-.28,.79,-.05]);s.b('tool_satchel',[0,0,0],[.2,.26,.29],'accent');s.part('service_pack',[0,1.02,-.23]);s.b('service_pack',[0,0,0],[.32,.4,.19],'dark');for(const sign of [-1,1])s.b('service_pack',[sign*.1,0,-.12],[.055,.3,.07],'accent');}}
 else{s.part('hood',[0,1.58,-.01]);s.b('hood',[0,0,0],[.40,.14,.37],'dark');for(const sign of [-1,1])s.b('hood',[sign*.18,-.17,0],[.075,.3,.31]);s.part('backpack',[0,1.04,-.24]);s.b('backpack',[0,0,0],[.38,.43,.22],'accent');s.b('backpack',[0,.22,0],[.41,.09,.24],'dark');s.part('belt',[0,.8,.02]);s.b('belt',[0,0,0],[.49,.08,.34],'dark');s.b('belt',[.08,0,.19],[.10,.09,.055],'accent');s.part('scarf',[0,1.29,.17]);s.b('scarf',[0,0,0],[.37,.10,.15],'belly');s.b('scarf',[-.1,-.14,.06],[.1,.3,.065],'belly');}
 s.a('interaction_focus','head',[0,.1,.2],'dialogue camera and interaction visual locator');
}
function drone(s){
 s.part('central_hull',[0,.42,0],'root','hull_visual');s.b('central_hull',[0,0,0],[.66,.32,.65]);s.b('central_hull',[0,.17,0],[.46,.10,.47],'belly');s.b('central_hull',[0,-.17,0],[.48,.07,.49],'dark');
 for(let i=0;i<3;i++){const x=i===0?0:(i===1?-.46:.46),z=i===0?-.45:.24,id=s.part('thruster_'+i,[x,.3,z],'root','thruster_visual');s.b(id,[0,0,0],[.3,.27,.33],'dark');s.b(id,[0,-.15,0],[.24,.07,.27],'accent');s.b(id,[0,.14,0],[.32,.06,.35],'belly');s.a('thrust_locator_'+i,id,[0,-.2,0],'visual thruster locator; no propulsion function');}
 s.part('sensor',[0,.42,.4]);s.b('sensor',[0,0,0],[.38,.22,.18],'dark');s.b('sensor',[0,0,.11],[.25,.11,.055],'accent');s.b('sensor',[0,0,.145],[.10,.065,.03],'ivory');s.part('top_antenna',[0,.65,-.1]);s.b('top_antenna',[0,.13,0],[.045,.27,.045],'dark');s.b('top_antenna',[0,.27,0],[.16,.065,.075],'accent');s.a('survey_origin','sensor',[0,0,.19],'visual scan and aim origin');
}
function finish(s){
 const a=asset(s.e,'creature',.03125),pal=palettes[s.e.id];['coat','belly','dark','accent'].forEach((id,i)=>mat(a,id,pal[i],{metallic:s.e.entityType==='inorganic'?.65:.03}));mat(a,'ivory','#EEE4C9');mat(a,'ink','#17212B');
 const world=new Map([['root',[0,0,0]]]);for(const p of s.parts.slice(1)){let w=world.get(p.parent);world.set(p.id,p.p.map((x,i)=>x+w[i]));}
 let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of s.parts)for(const b of p.boxes)for(let i=0;i<3;i++){const v=world.get(p.id)[i]+b.c[i];lo[i]=Math.min(lo[i],v-b.s[i]/2);hi[i]=Math.max(hi[i],v+b.s[i]/2);}
 const [L,W,H]=s.e.body.lengthWidthHeightM,g=a.visualGridM,target=[W,H,L].map(v=>Math.max(g,Math.round(v/g)*g)),factor=target.map((v,i)=>v/(hi[i]-lo[i])),offset=[-target[0]/2,0,-target[2]/2].map(v=>Math.round(v/g)*g);
 const transform=(p)=>p.map((v,i)=>Math.round(((v-lo[i])*factor[i]+offset[i])/g)*g);
 const pivots=new Map([['root',[0,0,0]]]);for(const p of s.parts.slice(1)){let pp=pivots.get(p.parent),v=transform(world.get(p.id));pivots.set(p.id,v);part(a,p.id,v.map((x,i)=>x-pp[i]),p.parent,p.role);}
 for(const p of s.parts)for(const b of p.boxes){let wp=world.get(p.id),pivot=pivots.get(p.id),low=transform(b.c.map((v,i)=>v+wp[i]-b.s[i]/2)),high=transform(b.c.map((v,i)=>v+wp[i]+b.s[i]/2));for(let i=0;i<3;i++)if(high[i]<=low[i]){if(low[i]>=offset[i]+target[i])low[i]-=g;else high[i]=low[i]+g;}box(a,p.id,low.map((v,i)=>(v+high[i])/2-pivot[i]),high.map((v,i)=>v-low[i]),b.m);}
 for(const n of s.anchors){const wp=world.get(n.p),pv=pivots.get(n.p),pos=transform(n.pos.map((v,i)=>v+wp[i]));anchor(a,n.id,n.p,pos.map((v,i)=>v-pv[i]),n.purpose);}
 anchor(a,'ground_origin','root',[0,0,0],'visual placement origin');a.notes.push('재사용 가능한 절차적 복셀 시각 원본. 게임·충돌·HP·공격·부위 기능·애니메이션은 미통합.',`전체 실루엣(뿔·날개·소지 시각소품 포함)을 설계 L/W/H ${L}/${W}/${H}m에 맞춤. 표현 격자 ${g}m로 반올림. 질량·장기 물성은 시각 모델에서 계산하지 않음.`,s.e.concept,'전면 +Z, 지면 Y=0. 부위 parent와 피벗은 편집·애니메이션 준비용이며 생물 기능 연결의 구현을 뜻하지 않음.');return a;
}
export function generate(content){
 return content.creatures.entries.map(e=>{const s=new Shape(e);switch(e.id){
 case 'moss_deer':quadruped(s,'deer');for(let i=0;i<9;i++)s.b('thorax',[(i%3-1)*.12,.25,-.3+Math.floor(i/3)*.18],[.08,.045,.10],i%2?'accent':'belly');break;
 case 'copper_fox':quadruped(s,'fox');break;
 case 'azure_beetle':beetle(s,'beetle');break;
 case 'root_stalker':quadruped(s,'stalker');break;
 case 'scree_hare':quadruped(s,'hare');for(const side of [-1,1])s.b('thorax',[side*.22,.14,-.15],[.035,.11,.35],'dark');break;
 case 'flint_jackal':quadruped(s,'jackal');break;
 case 'ore_mite':beetle(s,'mite');break;
 case 'shaft_weasel':quadruped(s,'weasel');break;
 case 'reed_grazer':quadruped(s,'reed');break;
 case 'mud_croc':quadruped(s,'croc');break;
 case 'silt_snail':snail(s);break;
 case 'drain_eel':serpent(s,true);break;
 case 'ash_goat':quadruped(s,'goat');for(let i=0;i<5;i++)s.b('thorax',[0,.25,-.35+i*.17],[.3,.06,.10],'belly');break;
 case 'ember_lizard':quadruped(s,'lizard');break;
 case 'vent_grub':grub(s);break;
 case 'furnace_mantis':mantis(s);break;
 case 'cliff_ibex':quadruped(s,'ibex');break;
 case 'gale_raptor':wings(s,false);break;
 case 'tide_crab':beetle(s,'crab');break;
 case 'cistern_serpent':serpent(s,false);break;
 case 'prism_deer':quadruped(s,'deer');s.part('leaf_mantle',[0,1.16,-.1]);for(const side of [-1,1])for(let i=0;i<4;i++)s.b('leaf_mantle',[side*(.21+i*.016),-.07*i,-.32+i*.17],[.12,.24,.14],'accent');for(const sign of [-1,1])s.b('antler_'+sign,[sign*.08,.3,-.04],[.13,.18,.1],'accent');break;
 case 'veil_cat':quadruped(s,'cat');break;
 case 'mana_moth':wings(s,true);break;
 case 'root_weaver':spider(s);break;
 case 'candle_hare':quadruped(s,'hare');s.part('candle_mane',[0,.95,-.08]);for(let i=0;i<5;i++)s.b('candle_mane',[(i-2)*.06,.10-Math.abs(i-2)*.035,-.05],[.06,.20-Math.abs(i-2)*.04,.12],'accent');for(const side of [-1,1])s.b('head_ear_'+(side<0?'l':'r'),[0,.36,.065],[.06,.20,.035],'accent');break;
 case 'relic_hound':quadruped(s,'hound');break;
 case 'shrine_beetle':beetle(s,'shrine');break;
 case 'oath_sentinel':humanoid(s,true,true);break;
 case 'drift_grazer':quadruped(s,'drift');break;
 case 'phase_stalker':quadruped(s,'phase');break;
 case 'anchor_tick':beetle(s,'tick');break;
 case 'survey_drone':drone(s);break;
 case 'wayfarer_organic':humanoid(s,false,false);break;
 case 'custodian_inorganic':humanoid(s,true,false);break;
 default:throw Error('Unspecified creature visual '+e.id);
 }return finish(s);});
}
