#include "feral_game.hpp"
#include "storage.hpp"
#include "machine_panel.hpp"
#include <godot_cpp/classes/button.hpp>
#include <godot_cpp/classes/h_box_container.hpp>
#include <godot_cpp/classes/grid_container.hpp>
#include <godot_cpp/classes/scroll_container.hpp>
#include <godot_cpp/classes/panel_container.hpp>
#include <godot_cpp/classes/margin_container.hpp>
#include <godot_cpp/classes/color_rect.hpp>
#include <godot_cpp/classes/style_box_flat.hpp>
#include <godot_cpp/classes/font_file.hpp>
#include <godot_cpp/classes/resource_loader.hpp>
#include <godot_cpp/classes/spin_box.hpp>
#include <godot_cpp/classes/check_button.hpp>
#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/os.hpp>
#include <godot_cpp/classes/time.hpp>
#include <cstdio>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/classes/texture_rect.hpp>
#include <godot_cpp/classes/texture2d.hpp>
#include <godot_cpp/classes/text_server.hpp>
#include <limits>

namespace feral {
using namespace godot;
namespace {
std::string number(double n){if(std::abs(n-std::round(n))<.001)return std::to_string(int(n));char b[32];std::snprintf(b,sizeof(b),"%.1f",n);return b;}
std::string named(const Content& c,const std::string& id){return c.find(id).value("name",id);}
std::string cost_text(const Content& c,const Json& items){std::string out;if(items.is_object())for(auto it=items.begin();it!=items.end();++it){if(!out.empty())out+=" · ";out+=named(c,it.key())+" "+(it.value().is_number()?number(it.value().get<double>()):"?");}return out;}
std::string selector_part_name(const std::string& id){
    static const std::map<std::string,std::string> labels={{"body","몸체"},{"root","몸통"},{"core","핵심부"},{"locomotion","이동 지지부"},
        {"head","머리"},{"neck","목"},{"thorax","가슴"},{"tail","꼬리"},{"spine","척추"},{"shell","외피"},{"weapon","무장"},
        {"left_foreleg","왼쪽 앞다리"},{"right_foreleg","오른쪽 앞다리"},{"left_hindleg","왼쪽 뒷다리"},{"right_hindleg","오른쪽 뒷다리"},
        {"left_wing","왼쪽 날개"},{"right_wing","오른쪽 날개"},{"foot","발"},{"mouth","입"},{"carapace","등갑"}};
    if(auto found=labels.find(id);found!=labels.end())return found->second;
    auto side_label=[&](const std::string& prefix,const std::string& part){
        if(id.rfind(prefix,0)!=0)return std::string{};const std::string suffix=id.substr(prefix.size());
        const bool left=suffix.rfind("-1",0)==0;const std::string side=left?"왼쪽 ":"오른쪽 ";
        if(part=="leg")return side+(suffix.find('_')==std::string::npos?"다리":"다리 "+suffix.substr(suffix.find('_')+1));
        return side+part;
    };
    if(id.rfind("leg_",0)==0)return side_label("leg_","다리");
    if(id.rfind("walking_leg_",0)==0)return side_label("walking_leg_","다리");
    if(id.rfind("wing_",0)==0)return side_label("wing_","날개");
    if(id.rfind("thruster_",0)==0)return side_label("thruster_","추진기");
    if(id.rfind("segment_",0)==0)return "척추 구간 "+id.substr(8);
    if(id.rfind("head_",0)==0)return "머리 · "+id.substr(5);
    if(id.rfind("eye_stalk_",0)==0)return "눈자루 · "+(id.rfind("eye_stalk_-1",0)==0?std::string("왼쪽"):std::string("오른쪽"));
    if(id.rfind("antenna_",0)==0)return "더듬이 · "+(id.rfind("antenna_-1",0)==0?std::string("왼쪽"):std::string("오른쪽"));
    if(id.rfind("antler_",0)==0)return "뿔 · "+(id.rfind("antler_-1",0)==0?std::string("왼쪽"):std::string("오른쪽"));
    if(id.find("scute")!=std::string::npos||id.find("carapace")!=std::string::npos)return "등갑";
    if(id.find("claw")!=std::string::npos||id.find("talon")!=std::string::npos)return "발톱";
    if(id.find("tail")!=std::string::npos)return "꼬리";
    if(id.find("root_shoulder")!=std::string::npos)return "어깨";
    return "부위 · "+id;
}
std::string selector_gimmick_name(const std::string& id){
    const std::string side=id.find("west")!=std::string::npos?"서쪽":id.find("east")!=std::string::npos?"동쪽":"전장";
    const std::string object=id.find("food_cache")!=std::string::npos?"먹이 더미":id.find("pillar")!=std::string::npos?"기둥":id.find("valve")!=std::string::npos?"배수 밸브":"장치";
    return side+" "+object;
}
}
void FeralGame::build_theme(){
    theme_.instantiate();Ref<FontFile> font=ResourceLoader::get_singleton()->load("res://fonts/FeralKorean.otf");theme_->set_default_font(font);theme_->set_default_font_size(20);
    theme_->set_color("font_color","Label",Color(.89,.91,.84));theme_->set_color("font_color","Button",Color(.89,.91,.84));
    theme_->set_constant("separation","VBoxContainer",10);theme_->set_constant("separation","HBoxContainer",12);
    for(auto type:{"Button","OptionButton","LineEdit","SpinBox"})for(auto state:{"normal","hover","pressed","focus","read_only"}){
        Ref<StyleBoxFlat> style;style.instantiate();bool hover=std::string(state)=="hover";style->set_bg_color(hover?Color(.20,.28,.25,.98):Color(.10,.15,.14,.94));
        style->set_border_color(std::string(state)=="focus"?Color(.83,.68,.36):Color(.32,.40,.34));style->set_border_width_all(1);style->set_corner_radius_all(4);
        style->set_content_margin(SIDE_LEFT,18);style->set_content_margin(SIDE_RIGHT,18);style->set_content_margin(SIDE_TOP,12);style->set_content_margin(SIDE_BOTTOM,12);theme_->set_stylebox(state,type,style);
    }
    Ref<StyleBoxFlat> panel;panel.instantiate();panel->set_bg_color(Color(.055,.085,.075,.97));panel->set_border_color(Color(.45,.48,.34));panel->set_border_width_all(1);panel->set_corner_radius_all(8);
    for(auto side:{SIDE_LEFT,SIDE_RIGHT,SIDE_TOP,SIDE_BOTTOM})panel->set_content_margin(side,24);theme_->set_stylebox("panel","PanelContainer",panel);
}
void FeralGame::clear_screen(){
    const bool collecting_hud_bindings=collect_hud_touch_bindings_;clear_input_state();hud_touch_bindings_.clear();collect_hud_touch_bindings_=collecting_hud_bindings;
    if(screen_){screen_->queue_free();screen_=nullptr;}hud_=nullptr;hud_status_=toast_=target_label_=nullptr;panel_body_=nullptr;name_input_=nullptr;preset_input_=nullptr;timeline_=nullptr;preview_running_=false;form_inputs_.clear();
    if(!canvas_){canvas_=memnew(CanvasLayer);add_child(canvas_);}screen_=memnew(Control);screen_->set_theme(theme_);canvas_->add_child(screen_);screen_->set_anchors_and_offsets_preset(Control::PRESET_FULL_RECT);screen_->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
}
void FeralGame::add_label(Node* parent,const std::string& text,int size){auto label=memnew(Label);label->set_text(gs(text));label->add_theme_font_size_override("font_size",size);if(Object::cast_to<HBoxContainer>(parent)){label->set_autowrap_mode(TextServer::AUTOWRAP_OFF);label->set_custom_minimum_size({145,0});label->set_h_size_flags(Control::SIZE_SHRINK_BEGIN);}else label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);parent->add_child(label);}
void FeralGame::add_button(Node* parent,const std::string& label,const std::string& command,Json args){auto button=memnew(Button);button->set_text(gs(label));button->set_custom_minimum_size({0,52});button->connect("pressed",Callable(this,"ui_command").bind(gs(command),gs(args.dump())));parent->add_child(button);if(collect_hud_touch_bindings_)register_hud_touch_button(button,command,args);}
VBoxContainer* FeralGame::make_panel(const std::string& title,bool wide){
    auto shade=memnew(ColorRect);shade->set_color(Color(.015,.025,.02,.56));screen_->add_child(shade);shade->set_anchors_and_offsets_preset(Control::PRESET_FULL_RECT);
    auto panel=memnew(PanelContainer);screen_->add_child(panel);panel->set_anchor(SIDE_LEFT,wide?.06:.24,true);panel->set_anchor(SIDE_RIGHT,wide?.94:.76,true);panel->set_anchor(SIDE_TOP,.07,true);panel->set_anchor(SIDE_BOTTOM,.93,true);
    auto column=memnew(VBoxContainer);panel->add_child(column);auto header=memnew(HBoxContainer);column->add_child(header);auto label=memnew(Label);label->set_text(gs(title));label->add_theme_font_size_override("font_size",30);label->set_h_size_flags(Control::SIZE_EXPAND_FILL);header->add_child(label);
    add_button(header,"닫기",playing_?"resume":"launcher");auto scroll=memnew(ScrollContainer);scroll->set_v_size_flags(Control::SIZE_EXPAND_FILL);column->add_child(scroll);
    auto body=memnew(VBoxContainer);body->set_h_size_flags(Control::SIZE_EXPAND_FILL);scroll->add_child(body);return body;
}
void FeralGame::show_launcher(){
    clear_screen();panel_="launcher";if(!playing_){paused_=false;get_tree()->set_pause(false);}Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_VISIBLE);
    auto background=memnew(ColorRect);background->set_color(Color(.035,.07,.06));screen_->add_child(background);background->set_anchors_and_offsets_preset(Control::PRESET_FULL_RECT);
    auto left=memnew(VBoxContainer);screen_->add_child(left);left->set_anchor(SIDE_LEFT,.08,true);left->set_anchor(SIDE_RIGHT,.39,true);left->set_anchor(SIDE_TOP,.18,true);left->set_anchor(SIDE_BOTTOM,.88,true);
    add_label(left,"F E R A L",64);add_label(left,"깎고, 만들고, 살아가는 세계",23);add_label(left,"EXPLORE · SHAPE · SURVIVE",14);
    auto spacer=memnew(Control);spacer->set_custom_minimum_size({0,50});left->add_child(spacer);add_button(left,"새로운 세계","new_world");add_button(left,"환경 설정","panel",{{"name","settings"}});add_button(left,"행동 타임라인","panel",{{"name","actions"}});add_button(left,"업데이트","panel",{{"name","updates"}});add_button(left,"저장 가져오기","panel",{{"name","import"}});
    toast_=memnew(Label);toast_->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);left->add_child(toast_);
    auto list=memnew(VBoxContainer);screen_->add_child(list);list->set_anchor(SIDE_LEFT,.48,true);list->set_anchor(SIDE_RIGHT,.91,true);list->set_anchor(SIDE_TOP,.18,true);list->set_anchor(SIDE_BOTTOM,.87,true);add_label(list,"이어가기",28);
    if(legacy_import_pending_){add_label(list,migration_error_.empty()?"기존 저장을 확인하고 있습니다.":"기존 저장을 가져오지 못했습니다. 원본은 보존되어 있습니다.",20);if(!migration_error_.empty())add_button(list,"저장 가져오기 다시 시도","retry_migration");}
    catalog_=storage_?storage_->list_worlds():Json::array();if(catalog_.is_array())for(const auto& w:catalog_){auto row=memnew(HBoxContainer);list->add_child(row);auto button=memnew(Button);button->set_text(gs(w.value("name",std::string("세계"))));button->set_custom_minimum_size({0,70});button->set_h_size_flags(Control::SIZE_EXPAND_FILL);button->connect("pressed",Callable(this,"ui_command").bind("play",gs(Json{{"id",w["id"]}}.dump())));row->add_child(button);add_button(row,"설정","panel",{{"name","world_settings"},{"id",w["id"]}});}
    if(!catalog_.is_array()||catalog_.empty())add_label(list,"아직 만든 세계가 없습니다.\n새로운 세계를 만들어 탐험을 시작하세요.",20);
}
void FeralGame::show_create_world(){
    clear_screen();panel_="create";auto body=make_panel("새로운 세계");panel_body_=body;add_label(body,"세계 이름");name_input_=memnew(LineEdit);name_input_->set_text(gs("나의 세계"));body->add_child(name_input_);
    add_label(body,"시작 환경");preset_input_=memnew(OptionButton);for(const auto& id:{"expedition","island","frontier","machine"}){preset_input_->add_item(gs(presets_["presets"][id]["name"].get<std::string>()));preset_input_->set_item_metadata(preset_input_->get_item_count()-1,gs(id));}body->add_child(preset_input_);
    add_label(body,"세계 씨앗");auto seed=memnew(SpinBox);seed->set_min(0);seed->set_max(2147483647);seed->set_step(1);seed->set_value(63026);body->add_child(seed);form_inputs_["seed"]=seed;
    for(auto it=presets_["rules"].begin();it!=presets_["rules"].end();++it){auto check=memnew(CheckButton);check->set_text(gs(it.value().value("label",it.key())));body->add_child(check);form_inputs_[it.key()]=check;add_label(body,it.value().value("help",std::string{}),16);}
    preset_changed(0);preset_input_->connect("item_selected",Callable(this,"preset_changed"));add_button(body,"탐험 시작","create_world");
}
void FeralGame::preset_changed(int64_t index){
    if(!preset_input_)return;std::string id=fs(preset_input_->get_item_metadata(index));const auto& rules=presets_["presets"][id]["rules"];
    for(auto [key,input]:form_inputs_)if(auto check=Object::cast_to<CheckButton>(input))check->set_pressed(rules.value(key,false));
}
void FeralGame::build_hud(){
    clear_input_state();collect_hud_touch_bindings_=true;clear_screen();panel_.clear();paused_=false;get_tree()->set_pause(false);hud_=screen_;
    auto top=memnew(HBoxContainer);screen_->add_child(top);top->set_anchor(SIDE_LEFT,.025,true);top->set_anchor(SIDE_RIGHT,.975,true);top->set_anchor(SIDE_TOP,.025,true);top->set_offset(SIDE_BOTTOM,82);
    hud_status_=memnew(Label);hud_status_->set_h_size_flags(Control::SIZE_EXPAND_FILL);top->add_child(hud_status_);add_button(top,"장부","panel",{{"name","journal"}});add_button(top,"메뉴","panel",{{"name","pause"}});
    auto cross=memnew(Label);cross->set_text(gs("·"));cross->add_theme_font_size_override("font_size",36);screen_->add_child(cross);cross->set_anchor(SIDE_LEFT,.5,true);cross->set_anchor(SIDE_TOP,.5,true);cross->set_position(cross->get_position()+Vector2(-5,-25));cross->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
    target_label_=memnew(Label);screen_->add_child(target_label_);target_label_->set_anchor(SIDE_LEFT,.36,true);target_label_->set_anchor(SIDE_RIGHT,.7,true);target_label_->set_anchor(SIDE_TOP,.56,true);target_label_->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);
    toast_=memnew(Label);screen_->add_child(toast_);toast_->set_anchor(SIDE_LEFT,.2,true);toast_->set_anchor(SIDE_RIGHT,.8,true);toast_->set_anchor(SIDE_TOP,.78,true);toast_->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);toast_->add_theme_color_override("font_color",Color(.94,.82,.48));
    auto bottom=memnew(HBoxContainer);screen_->add_child(bottom);bottom->set_anchor(SIDE_LEFT,settings_.value("leftHand",false)?.06:.34,true);bottom->set_anchor(SIDE_RIGHT,settings_.value("leftHand",false)?.66:.94,true);bottom->set_anchor(SIDE_TOP,.87,true);bottom->set_anchor(SIDE_BOTTOM,.97,true);
    add_button(bottom,"가방","panel",{{"name","inventory"}});add_button(bottom,"사용","interact");add_button(bottom,"잡기 / 던지기","grip");add_button(bottom,"점프","jump");add_button(bottom,"자세","stance");
    auto attack=memnew(Button);attack->set_text(gs("타격"));attack->set_custom_minimum_size({110,64});attack->connect("button_down",Callable(this,"ui_command").bind("attack.on","{}"));attack->connect("button_up",Callable(this,"ui_command").bind("attack.off","{}"));bottom->add_child(attack);register_hud_touch_button(attack,"attack",Json::object(),true);collect_hud_touch_bindings_=false;
    if(!smoke_&&!OS::get_singleton()->has_feature("mobile"))Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_CAPTURED);refresh_hud();
}
void FeralGame::refresh_hud(){
    if(!gameplay_)return;if(hud_status_){const auto& p=gameplay_->player_state();hud_status_->set_text(gs("체력 "+number(p.value("hp",100.0))+"    식량 "+number(p.value("calories",600.0))+"    "+(held_.empty()?"맨손":named(content_,held_))));}
    if(target_label_&&!paused_){auto actor=actor_pose();aim_=aim_contact(actor.origin,feral::rotate(actor.rotation,{0,0,-1}),6.5);std::string name;if(aim_.hit)name=aim_.kind=="terrain"?named(content_,aim_.material):aim_.kind=="body"?"분리된 물체":aim_.kind=="machine"?"조립 기계":aim_.id;target_label_->set_text(gs(name));}
}
void FeralGame::notice(const std::string& text){toast_remaining_=4;if(toast_)toast_->set_text(gs(text));}
void FeralGame::show_panel(const std::string& name,Json args){
    if(playing_&&!paused_)physics_feedback();
    clear_input_state();hud_touch_bindings_.clear();collect_hud_touch_bindings_=false;clear_screen();panel_=name;panel_args_=args;const std::set<std::string> pause_panels={"pause","settings","world_settings","actions","action_detail","updates","import","death"};paused_=playing_&&pause_panels.count(name);get_tree()->set_pause(paused_);Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_VISIBLE);
    static const std::map<std::string,std::string> titles={{"pause","탐험 메뉴"},{"journal","탐험 장부"},{"inventory","가방"},{"craft","제작"},{"research","연구"},{"build","시설 설치"},{"machines","기계"},{"community","공동체"},{"faith","신앙"},{"campaign","여정"},{"map","지도"},{"actions","행동 타임라인"},{"settings","환경 설정"},{"inspect","대상 살펴보기"},{"world_settings","세계 설정"},{"import","저장 가져오기"},{"updates","업데이트"},{"action_detail","행동 궤적 편집"},{"form","행동 선택"},{"energy","에너지"},{"equipment","장비"},{"explore","탐사"},{"catalog","도감"},{"progression","진행 현황"},{"survival","생존"},{"death","회복"},{"result","기록"},{"sandbox","세계 도구"},{"delete_world","세계 삭제"}};
    auto it=titles.find(name);panel_body_=make_panel(it==titles.end()?name:it->second,true);refresh_panel();
}
void FeralGame::refresh_panel(){
    auto body=panel_body_;if(!body)return;const std::set<std::string> local_panels={"pause","journal","actions","action_detail","settings","updates","world_settings","import","death","result","map"};bool needs_state=!local_panels.count(panel_);Json view=gameplay_&&needs_state?gameplay_->view():Json::object(),sim=simulation_&&needs_state?simulation_->view():Json::object();
    if(panel_=="result"){render_result(body,panel_args_.value("result",Json::object()));add_button(body,"장부로","panel",{{"name","journal"}});
    }else if(panel_=="death"){
        add_label(body,"쓰러졌습니다",34);add_label(body,config_.value("rules",Json::object()).value("dropOnDeath",true)?"소지품은 쓰러진 곳에 남아 있습니다. 가까이 돌아가면 회수할 수 있습니다.":"소지품을 지닌 채 야영지에서 깨어납니다.",20);add_button(body,"깨어나기","respawn");
    }else if(panel_=="pause"){
        add_button(body,"탐험 계속","resume");add_button(body,"저장","save");add_button(body,"행동 타임라인","panel",{{"name","actions"}});add_button(body,"환경 설정","panel",{{"name","settings"}});add_button(body,"업데이트","panel",{{"name","updates"}});add_button(body,"저장하고 세계 나가기","leave");
    }else if(panel_=="journal"){
        auto grid=memnew(GridContainer);grid->set_columns(3);body->add_child(grid);
        for(auto pair:std::vector<std::pair<std::string,std::string>>{{"가방","inventory"},{"제작","craft"},{"연구","research"},{"시설","build"},{"기계","machines"},{"에너지","energy"},{"장비","equipment"},{"공동체","community"},{"신앙","faith"},{"여정","campaign"},{"지도","map"},{"탐사","explore"},{"도감","catalog"},{"진행","progression"},{"생존","survival"}})add_button(grid,pair.first,"panel",{{"name",pair.second}});if(config_.value("rules",Json::object()).value("sandbox",false))add_button(grid,"세계 도구","panel",{{"name","sandbox"}});
    }else if(panel_=="inventory"){
        Json items=view.value("progression",Json::object()).value("inventory",Json::object());
        auto grid=memnew(GridContainer);grid->set_columns(4);body->add_child(grid);
        if(items.is_object())for(auto it=items.begin();it!=items.end();++it)if(it.value().is_number()&&it.value().get<double>()>0){auto tile=memnew(PanelContainer);tile->set_custom_minimum_size({235,165});grid->add_child(tile);auto row=memnew(VBoxContainer);tile->add_child(row);
            String icon=gs("res://icons/"+it.key()+".png");if(FileAccess::file_exists(icon)){auto image=memnew(TextureRect);Ref<Texture2D> texture=ResourceLoader::get_singleton()->load(icon);image->set_texture(texture);image->set_expand_mode(TextureRect::EXPAND_IGNORE_SIZE);image->set_stretch_mode(TextureRect::STRETCH_KEEP_ASPECT_CENTERED);image->set_custom_minimum_size({90,90});row->add_child(image);}
            add_label(row,named(content_,it.key())+" × "+number(it.value().get<double>()),18);if(content_.asset(it.key()).value("category",std::string{})=="equipment")add_button(row,"들기","equip",{{"id",it.key()}});}
        add_button(body,"제작하기","panel",{{"name","craft"}});add_button(body,"보관함에서 회수","game",{{"command","inventory.reclaim"}});
    }else if(panel_=="equipment"){
        const auto& state=view.value("armaments",Json::object());add_label(body,"휴대 무기",25);
        for(const auto& weapon:state.value("weapons",Json::array())){auto card=memnew(HBoxContainer);body->add_child(card);add_label(card,weapon.value("name",named(content_,weapon.value("patternId",std::string{})))+" · 내구도 "+number(weapon.value("durability",0.0))+" / "+number(weapon.value("maxDurability",0.0)),20);add_button(card,weapon.value("equipped",false)?"장착 중":"장착","game",{{"command","weapon.equip"},{"args",{{"id",weapon["id"]}}}});}
        if(state.value("weapons",Json::array()).empty())add_label(body,"아직 제작한 무기가 없습니다. 작업 설비에서 재료와 무기 형태를 골라 제작하세요.",18);
        add_button(body,"든 도구 내려놓기","empty_hand");
    }else if(panel_=="energy"){
        const auto energy=view.value("progression",Json::object()).value("energy",Json::object());auto grid=memnew(GridContainer);grid->set_columns(3);body->add_child(grid);
        for(auto [id,title]:std::vector<std::pair<std::string,std::string>>{{"mechanical","기계"},{"electrical","전기"},{"thermal","열"},{"chemical","화학"},{"magic","마나"},{"divine","신성"}}){auto card=memnew(PanelContainer);grid->add_child(card);auto column=memnew(VBoxContainer);card->add_child(column);add_label(column,title,24);add_label(column,number(energy.value("amounts",Json::object()).value(id,0.0))+" / "+number(energy.value("capacity",Json::object()).value(id,0.0))+" EU",20);}
        add_label(body,"설비와 케이블",25);for(const auto& fixture:view.value("placements",Json::object()).value("fixtures",Json::array()))add_label(body,named(content_,fixture.value("assetId",std::string{}))+" · 내구도 "+number(fixture.value("hp",0.0)),18);
    }else if(panel_=="community"||panel_=="faith"){
        const bool faith=panel_=="faith";const auto state=view.value(panel_,Json::object());Json targets=faith?state.value("shrines",Json::array()):state.value("communities",Json::array());
        if(!faith)for(const auto& r:state.value("residents",Json::array()))targets.push_back(r);
        if(targets.empty())add_label(body,faith?"탐험하면서 제단을 찾아보세요.":"탐험하면서 공동체와 주민을 찾아보세요.",20);
        for(const auto& target:targets){std::string id=target.value(faith?"instanceId":"id",std::string{});if(id.empty())continue;
            Json opts=gameplay_->command(faith?"faith.options":"community.options",faith?Json{{"instanceId",id}}:Json{{"targetId",id}});
            if(opts.value("options",Json::array()).empty())continue;add_label(body,target.value("name",faith?std::string("제단"):std::string("주민과 공동체")),24);
            for(const auto& option:opts["options"]){add_label(body,option.value("detail",std::string{}),16);auto button=memnew(Button);button->set_text(gs(option.value("label",std::string("상호작용"))));button->set_disabled(option.value("disabled",false));button->set_custom_minimum_size({0,52});Json args=faith?Json{{"instanceId",id},{"actionId",option["id"]}}:Json{{"targetId",id},{"type",option["type"]}};button->connect("pressed",Callable(this,"ui_command").bind("game",gs(Json{{"command",faith?"faith.interact":"community.interact"},{"args",args}}.dump())));body->add_child(button);}
        }add_button(body,"현재 상태 새로 보기","panel",{{"name",panel_}});
    }else if(panel_=="survival"){
        const auto state=view.value("player",Json::object());add_label(body,"체력 "+number(state.value("hp",100.0))+" / "+number(state.value("maxHp",100.0)),26);add_label(body,"식량 "+number(state.value("calories",0.0))+" / "+number(state.value("maxCalories",2400.0)),24);
        for(const auto& id:{"food","berry","cooked_meat"})if(gameplay_->count(id)>0)add_button(body,named(content_,id)+" 먹기","game",{{"command","survival.eat"},{"args",{{"itemId",id}}}});
        add_button(body,state.value("resting",false)?"휴식 마치기":"휴식하기","game",{{"command","survival.rest"},{"args",{{"resting",!state.value("resting",false)}}}});
    }else if(panel_=="progression"||panel_=="campaign"){
        const auto progress=view.value("progression",Json::object());add_label(body,"완료한 연구 "+std::to_string(progress.value("research",Json::array()).size())+" / 39",25);add_label(body,"대기 작업 "+std::to_string(progress.value("jobs",Json::array()).size())+" · 작업 지식 "+number(progress.value("workCredits",0.0)),20);
        for(const auto& job:progress.value("jobs",Json::array())){const auto status=job.value("status",Json::object());add_label(body,named(content_,job.value("recipeId",job.value("activityId",std::string{})))+" · "+number(status.value("progress",0.0))+" / "+number(status.value("total",0.0)),18);}
        for(const auto& id:progress.value("research",Json::array()))if(id.is_string())add_label(body,named(content_,id.get<std::string>()),18);
        if(panel_=="campaign")add_label(body,"회수한 핵 "+number(view.value("campaign",Json::object()).value("cores",0.0)),24);
    }else if(panel_=="explore"){
        add_label(body,"주변 대상",26);for(const auto& pose:simulation_->poses())if((pose.position-fv(player_->get_position())).length_squared()<32*32){add_label(body,content_.asset(pose.asset_id).value("name",pose.asset_id)+" · "+number((pose.position-fv(player_->get_position())).length())+" m",20);if(pose.kind=="corpse")add_button(body,"사체 회수","game",{{"command","creature.claim_drops"},{"args",{{"id",pose.id}}}});}
    }else if(panel_=="catalog"){
        add_label(body,"재료 · 설비 · 생물 도감",26);for(const auto& entry:content_.data["progression"]["entries"]){add_label(body,entry.value("name",std::string{}),22);if(entry.contains("description")&&entry["description"].is_string())add_label(body,entry["description"].get<std::string>(),17);}
    }else if(panel_=="craft"||panel_=="research"||panel_=="build"){
        for(const auto& row:content_.data["progression"]["entries"]){std::string kind=row.value("kind",std::string{}),id=row.value("id",std::string{});bool show=panel_=="craft"?kind=="recipe":panel_=="research"?kind=="research":kind=="station"||kind=="component";
            if(!show)continue;auto box=memnew(VBoxContainer);body->add_child(box);add_label(box,row.value("name",id),23);
            if(row.contains("inputs"))add_label(box,cost_text(content_,row["inputs"]),16);
            Json args=panel_=="craft"?Json{{"command","craft.queue"},{"args",{{"recipeId",id},{"count",1}}}}:panel_=="research"?Json{{"command","research.start"},{"args",{{"id",id}}}}:Json{{"command","placement.place"},{"args",{{"assetId",id}}}};
            add_button(box,panel_=="craft"?"제작 예약":panel_=="research"?"연구 시작":"조준한 곳에 설치","game",args);
        }
    }else if(panel_=="sandbox"){
        if(world_tools_){const Json metadata=world_tools_->metadata();for(auto command:metadata["commands"]){command["panel"]="sandbox";add_button(body,command.value("label",std::string("세계 도구")),"form",command);}}
    }else if(panel_=="machines"){
        auto panel=memnew(MachinePanel);body->add_child(panel);bool field=false;for(const auto& module:config_.value("modules",Json::array()))if(module=="machine-field")field=true;
        panel->configure(&content_,simulation_.get(),gameplay_.get(),world_.get(),[this](const std::string& command,Json args){return dispatch(command,args);},[this](){sync_dynamics(true);},fv(player_->get_position()),yaw_,field,panel_args_.value("id",std::string{}),[this](const std::string& id){auto result=enter_machine(id);if(result.value("ok",false))build_hud();return result;});
    }else if(panel_=="actions"){
        add_label(body,"판정과 화면 동작은 같은 60Hz 시간축을 읽습니다. 화면 동작을 꺼도 타격 결과는 같습니다.",18);
        add_button(body,visual_enabled_?"화면 동작 끄기":"화면 동작 켜기","toggle_visual");
        static const std::map<std::string,std::string> names={{"pick","곡괭이"},{"knife","절삭도구"},{"axe","도끼"},{"sword","검"},{"spear","창"},{"hammer","둔기"}};
        for(auto it=profiles_["profiles"].begin();it!=profiles_["profiles"].end();++it){auto& profile=it.value();std::string id=it.key();add_label(body,names.count(id)?names.at(id):id,24);add_button(body,"궤적 · 화면 동작 편집","panel",{{"name","action_detail"},{"id",id}});
            auto spin=[&](const std::string& title,const std::string& path,double value,double min,double max,double step){auto row=memnew(HBoxContainer);body->add_child(row);add_label(row,title,18);auto field=memnew(SpinBox);field->set_min(min);field->set_max(max);field->set_step(step);field->set_value(value);field->set_custom_minimum_size({160,48});field->connect("value_changed",Callable(this,"profile_changed").bind(gs(path),gs(id)));row->add_child(field);};
            spin("전체 길이 · 프레임","/durationFrames",profile.value("durationFrames",30),1,180,1);spin("도달 거리 · m","/reach",profile.value("reach",6.5),.5,12,.1);
            spin("한 번의 타격력","/damage",profile.value("damage",20.0),.1,1000,.1);spin("동작 전체 타격 예산","/energyBudget",profile.value("energyBudget",80.0),.1,10000,1);
            for(size_t k=0;k<profile["hitboxes"].size();k++){auto& hit=profile["hitboxes"][k];std::string prefix="/hitboxes/"+std::to_string(k);spin("타격 반경 · m",prefix+"/radius",hit.value("radius",.25),.02,2,.01);spin("최대 접촉 수",prefix+"/maxContacts",hit.value("maxContacts",4),1,128,1);
                if(hit.value("kind",std::string{})=="point")spin("타격 시점 · 프레임",prefix+"/hitFrame",hit.value("hitFrame",12),1,180,1);
                else{spin("판정 시작 · 프레임",prefix+"/activeStartFrame",hit.value("activeStartFrame",10),1,180,1);spin("판정 종료 · 프레임",prefix+"/activeEndFrame",hit.value("activeEndFrame",20),1,180,1);}
            }
        }add_button(body,"설정 저장","save_profiles");add_button(body,"기본 동작으로 복원","reset_profiles");
    }else if(panel_=="action_detail"){
        preview_profile_=panel_args_.value("id",std::string("pick"));const auto& profile=profiles_["profiles"][preview_profile_];
        add_label(body,"위쪽은 화면 동작, 아래쪽은 실제 판정입니다. 시간축을 눌러 해당 시점을 확인할 수 있습니다.",18);
        timeline_=memnew(ActionTimeline);timeline_->configure(profile);timeline_->connect("frame_selected",Callable(this,"preview_seek"));body->add_child(timeline_);add_button(body,"동작 재생","preview_action");
        auto keys=[&](const std::string& title,const Json& frames,const std::string& prefix,bool rotation){
            add_label(body,title,24);
            for(size_t k=0;k<frames.size();k++){const auto& key=frames[k];auto row=memnew(HBoxContainer);body->add_child(row);add_label(row,std::to_string(k+1),18);
                auto value=[&](const std::string& label,const std::string& path,double v,double lo,double hi,double step){auto column=memnew(VBoxContainer);row->add_child(column);add_label(column,label,15);auto spin=memnew(SpinBox);spin->set_min(lo);spin->set_max(hi);spin->set_step(step);spin->set_value(v);spin->set_custom_minimum_size({135,45});spin->connect("value_changed",Callable(this,"profile_changed").bind(gs(path),gs(preview_profile_)));column->add_child(spin);};
                std::string base=prefix+"/"+std::to_string(k);value("프레임",base+"/frame",key.value("frame",0.0),0,180,1);
                for(int axis=0;axis<3;axis++){std::string label=axis==0?"X":axis==1?"Y":"Z";value(label+" · m",base+"/position/"+std::to_string(axis),key["position"][axis].get<double>(),-10,10,.01);}
                if(rotation)for(int axis=0;axis<3;axis++)value(std::string(axis==0?"회전 X":axis==1?"회전 Y":"회전 Z"),base+"/rotationDegrees/"+std::to_string(axis),key["rotationDegrees"][axis].get<double>(),-360,360,1);
            }
        };
        keys("화면 동작 키프레임",profile["visual"],"/visual",true);
        for(size_t k=0;k<profile["hitboxes"].size();k++)if(profile["hitboxes"][k].contains("keyframes"))keys("물리 히트박스 위치",profile["hitboxes"][k]["keyframes"],"/hitboxes/"+std::to_string(k)+"/keyframes",false);
        add_button(body,"설정 저장","save_profiles");add_button(body,"타격 범위 설정으로","panel",{{"name","actions"}});
    }else if(panel_=="settings"){
        for(auto item:std::vector<std::tuple<std::string,std::string,double,double,double>>{{"시야각","fov",50,105,1},{"그리기 거리 · 4m 구역","viewDistance",3,16,1},{"시점 감도","sensitivity",.0005,.01,.0005}}){auto [title,id,lo,hi,step]=item;add_label(body,title);auto spin=memnew(SpinBox);spin->set_min(lo);spin->set_max(hi);spin->set_step(step);spin->set_value(settings_.value(id,lo));form_inputs_[id]=spin;body->add_child(spin);}for(auto [key,label]:std::vector<std::pair<std::string,std::string>>{{"sound","도구 소리"},{"leftHand","왼손 조작"},{"showRadar","좌표 표시"},{"showEvents","주변 사건 알림"}}){auto check=memnew(CheckButton);check->set_text(gs(label));check->set_pressed(settings_.value(key,key=="sound"));body->add_child(check);form_inputs_[key]=check;}add_button(body,"설정 적용","save_settings");
    }else if(panel_=="world_settings"){
        auto world=storage_->find_world(panel_args_.value("id",std::string{}));if(!world){add_label(body,"세계를 찾을 수 없습니다");return;}Json config=storage_->world_config((*world)["id"]);
        add_label(body,"세계 이름",20);name_input_=memnew(LineEdit);name_input_->set_text(gs(world->value("name",std::string{})));body->add_child(name_input_);for(auto it=config["rules"].begin();it!=config["rules"].end();++it){const auto& rule=presets_["rules"][it.key()];if(rule.value("when",std::string{})!="always")continue;auto check=memnew(CheckButton);check->set_text(gs(rule.value("label",it.key())));check->set_pressed(it.value().get<bool>());form_inputs_[it.key()]=check;body->add_child(check);add_label(body,rule.value("help",std::string{}),16);}add_button(body,"세계 설정 저장","save_world_settings",{{"id",(*world)["id"]}});add_button(body,"이 세계 삭제","panel",{{"name","delete_world"},{"id",(*world)["id"]}});
    }else if(panel_=="delete_world"){
        auto row=storage_->find_world(panel_args_.value("id",std::string{}));if(!row){add_label(body,"세계를 찾을 수 없습니다");return;}add_label(body,row->value("name",std::string("세계"))+"을 삭제할까요?",26);add_label(body,"이 세계는 월드 목록에서 사라집니다. 다른 세계는 유지됩니다.",18);add_button(body,"삭제 취소","launcher");add_button(body,"세계 삭제","delete_world_confirm",{{"id",(*row)["id"]}});
    }else if(panel_=="updates"){
        add_label(body,"업데이트",30);add_label(body,"새 버전은 APK 업데이트로 설치합니다. 앱을 삭제하지 않으면 기존 월드가 유지됩니다.",20);
        if(!update_status_.empty())add_label(body,update_status_,20);
        if(!Engine::get_singleton()->has_singleton("FeralUpdates"))add_button(body,"공개 배포 페이지 열기","release_page");
        else{
            add_button(body,"새 버전 확인","check_update");
            if(!update_info_.empty()){add_label(body,"게임 "+update_info_.value("gameVersion",std::string{})+" · 앱 "+update_info_.value("nativeVersion",std::string{}),24);if(update_info_.value("available",false)&&!update_downloaded_)add_button(body,"업데이트 다운로드 · "+number(update_info_.value("apkBytes",0.0)/1048576)+" MB","download_update");else if(!update_downloaded_)add_label(body,"현재 최신 버전입니다",20);}
            if(update_downloaded_){add_button(body,"저장하고 업데이트 설치","install_update");add_button(body,"앱 설치 허용 설정","install_permission");}
        }
    }else if(panel_=="import"){
        add_label(body,"기존 Android 앱에서 업데이트하면 같은 앱 저장소의 월드를 가져옵니다. 원본과 보관함은 보존됩니다. 다른 기기의 저장 내보내기 JSON 파일도 읽을 수 있습니다.",20);
        name_input_=memnew(LineEdit);name_input_->set_placeholder(gs("저장 내보내기 JSON 파일 경로"));body->add_child(name_input_);add_button(body,"저장 파일 가져오기","import_file");
    }else if(panel_=="map"){
        Vec3 p=fv(player_->get_position());add_label(body,"현재 위치  "+number(p.x)+" / "+number(p.z));auto map=memnew(GridContainer);map->set_columns(15);body->add_child(map);
        for(int z=-7;z<=7;z++)for(int x=-7;x<=7;x++){auto tile=memnew(ColorRect);tile->set_custom_minimum_size({22,22});auto sample=world_->surface_sample(p.x+x*8,p.z+z*8);tile->set_color(x==0&&z==0?Color(.95,.8,.4):sample.has_water?Color(.2,.4,.5):Color(.3,.45,.3));map->add_child(tile);}
    }else if(panel_=="form"){
        add_label(body,panel_args_.value("label",std::string("실행")),24);
        const std::string form_command=panel_args_.value("id",std::string{});const Vec3 form_player=fv(player_->get_position());
        auto selected_id=[&](const std::string& field_key){auto found=form_inputs_.find(field_key);if(found==form_inputs_.end())return std::string{};
            auto* option=Object::cast_to<OptionButton>(found->second);if(!option||option->get_selected()<0)return std::string{};Variant value=option->get_item_metadata(option->get_selected());return value.get_type()==Variant::STRING?fs(value):std::string{};};
        auto find_row=[](const Json& rows,const std::string& id){if(rows.is_array())for(const auto& row:rows)if(row.is_object()&&row.value("id",std::string{})==id)return row;return Json::object();};
        auto find_pose=[&](const std::string& id){for(const auto& pose:sim.value("poses",Json::array()))if(pose.value("id",std::string{})==id)return pose;return Json::object();};
        auto add_empty_choice=[](Json& field,const std::string& label){field["options"]=Json::array({{{"id",""},{"label",label}}});field["default"]="";};
        auto select_default=[&](Json& field,const std::string& preferred){
            std::string selected;const Json current=field.value("default",Json());if(current.is_string())selected=current.get<std::string>();
            const Json options=field.value("options",Json::array());auto has=[&](const std::string& id){for(const auto& option:options){const std::string candidate=option.is_string()?option.get<std::string>():option.is_object()&&option.contains("id")?(option["id"].is_string()?option["id"].get<std::string>():option["id"].dump()):std::string{};if(candidate==id)return true;}return false;};
            if(!has(selected))selected=has(preferred)?preferred:options.empty()?std::string{}:(options[0].is_string()?options[0].get<std::string>():options[0].value("id",std::string{}));field["default"]=selected;
        };
        for(auto f:panel_args_.value("fields",Json::array())){std::string key=f.value("key",std::string{}),type=f.value("type",std::string("string"));
            if(key=="claim"||key=="requestId"||key=="actorPosition"||key=="playerPosition"||type=="player"||type=="world_context"||type=="position"||type=="quaternion"||type=="vector3")continue;
            if(type=="content_id"){type="catalog";if(key=="speciesId"){f["options"]=Json::array();for(const auto& row:content_.data["creatures"]["entries"])f["options"].push_back({{"id",row["id"]},{"label",row["name"]}});}else{f["options"]=Json::array();for(auto it=view["progression"]["inventory"].begin();it!=view["progression"]["inventory"].end();++it)if(it.value().is_number()&&it.value().get<double>()>0)f["options"].push_back({{"id",it.key()},{"label",named(content_,it.key())}});}}
            if(type=="entity_id"){
                std::string expected_kind;if(form_command.rfind("creature.",0)==0)expected_kind="creature";else if(form_command.rfind("boss.",0)==0)expected_kind="boss";else if(form_command.rfind("dungeon.",0)==0)expected_kind="device";
                std::vector<std::pair<double,Json>> nearby;
                if(!expected_kind.empty())for(const auto& pose:sim.value("poses",Json::array()))if(pose.value("kind",std::string{})==expected_kind){
                    const std::string id=pose.value("id",std::string{});if(id.empty())continue;const Vec3 position=pose.value("position",Json::array({0,0,0})).get<Vec3>();const double distance=(position-form_player).length();if(distance>20)continue;
                    if(expected_kind=="creature"&&sim.value("creatures",Json::object()).contains(id)){const bool dead=sim["creatures"][id].value("dead",false);if(form_command=="creature.claim_drops"?!dead:dead)continue;}
                    nearby.push_back({distance,pose});
                }
                std::sort(nearby.begin(),nearby.end(),[](const auto& a,const auto& b){return a.first<b.first;});f["options"]=Json::array();
                for(const auto& [distance,pose]:nearby){const std::string id=pose.value("id",std::string{}),asset=pose.value("assetId",std::string{});std::string name=content_.asset(asset).value("name",asset);
                    if(expected_kind=="creature"&&sim.value("creatures",Json::object()).contains(id)&&sim["creatures"][id].value("dead",false))name="사체 · "+name;
                    f["options"].push_back({{"id",id},{"label",name+" · "+number(distance)+"m"}});}
                if(f["options"].empty())add_empty_choice(f,"가까운 대상이 없습니다");
                else{std::string preferred;if(aim_.hit&&aim_.kind==expected_kind)preferred=aim_.id;select_default(f,preferred);}
            }else if(type=="room_id"){
                const std::string target_id=selected_id("id");const Json dungeons=sim.value("dungeons",Json::object());auto dungeon_it=dungeons.find(target_id);Json dungeon=Json::object();if(dungeon_it!=dungeons.end())dungeon=*dungeon_it;
                const Json& structure_rows=content_.data.value("structures",Json::object()).value("entries",Json::array());const Json structure=find_row(structure_rows,dungeon.value("templateId",std::string{}));f["options"]=Json::array();
                double nearest=std::numeric_limits<double>::infinity();std::string nearest_room;const Vec3 origin=dungeon.value("origin",Json::array({0,0,0})).get<Vec3>();
                for(const auto& room:structure.value("rooms",Json::array())){const std::string id=room.value("id",std::string{});if(id.empty())continue;f["options"].push_back({{"id",id},{"label",room.value("name","방 · "+id)}});const Vec3 center=room.value("centerM",Json::array({0,0,0})).get<Vec3>();const double distance=(origin+center-form_player).length();if(distance<nearest){nearest=distance;nearest_room=id;}}
                if(f["options"].empty())add_empty_choice(f,"방 정보가 없습니다");else select_default(f,nearest_room);
            }else if(type=="part_id"){
                const std::string target_id=selected_id("id");
                const Json target=find_pose(target_id);const std::string asset=target.value("assetId",std::string{});f["options"]=Json::array();
                if(form_command=="creature.damage"){
                    f["options"].push_back({{"id","body"},{"label","몸체"}});const Json& model=content_.asset(asset);
                    for(const auto& part:model.value("parts",Json::array())){const std::string id=part.value("id",std::string{});if(id.empty()||id=="root")continue;f["options"].push_back({{"id",id},{"label",selector_part_name(id)}});}
                }else if(form_command=="boss.damage"||form_command=="boss.gimmick"){
                    const Json boss=find_row(content_.data.value("bosses",Json::object()).value("entries",Json::array()),asset);
                    if(form_command=="boss.damage"){
                        f["options"].push_back({{"id","body"},{"label","몸체"}});
                        for(const auto& part:boss.value("parts",Json::array())){const std::string id=part.value("id",std::string{});if(id!="core"&&id!="locomotion")continue;f["options"].push_back({{"id",id},{"label",part.value("name",selector_part_name(id))}});}
                    }else for(const auto& gimmick:boss.value("arena",Json::object()).value("gimmicks",Json::array())){const std::string id=gimmick.value("id",std::string{});if(!id.empty())f["options"].push_back({{"id",id},{"label",selector_gimmick_name(id)}});}
                }else if(form_command=="dungeon.device"){
                    const Json dungeon=sim.value("dungeons",Json::object()).value(target_id,Json::object());const Json structure=find_row(content_.data.value("structures",Json::object()).value("entries",Json::array()),dungeon.value("templateId",std::string{}));
                    int index=0;for(const auto& anchor:structure.value("puzzle",Json::object()).value("componentAnchors",Json::array())){const std::string id=anchor.value("id",std::string{}),component=anchor.value("componentId",std::string{});if(!id.empty())f["options"].push_back({{"id",id},{"label","설치 위치 "+std::to_string(++index)+" · "+named(content_,component)}});}
                }
                if(f["options"].empty()){
                    if(aim_.hit&&aim_.id==target_id&&!aim_.part.empty())f["options"].push_back({{"id",aim_.part},{"label",selector_part_name(aim_.part)}});
                    if(f["options"].empty())add_empty_choice(f,"선택할 부위가 없습니다");
                }
                std::string preferred;if(aim_.hit&&aim_.id==target_id)preferred=aim_.part;select_default(f,preferred);
            }
            if((type=="catalog"||type=="source")&&!f.contains("options")){
                std::string kind=f.value("catalogKind",type=="source"?std::string("energy_source"):std::string{});f["options"]=Json::array();
                if(kind=="environment")for(const auto& row:content_.data["environments"]["entries"])f["options"].push_back({{"id",row["id"]},{"label",row["name"]}});
                else for(const auto& row:content_.data["progression"]["entries"]){std::string k=row.value("kind",std::string{});if(k==kind||(kind=="station/component"&&(k=="station"||k=="component")))f["options"].push_back({{"id",row["id"]},{"label",row["name"]}});}
            }else if(type=="fixture"||type=="job"){
                f["options"]=Json::array();Json rows=type=="fixture"?view.value("placements",Json::object()).value("fixtures",Json::array()):view.value("progression",Json::object()).value("jobs",Json::array());
                for(const auto& row:rows){std::string id=row.value("id",std::string{}),item=row.value("assetId",row.value("recipeId",std::string{}));f["options"].push_back({{"id",id},{"label",named(content_,item)}});}
            }else if(type=="target"||type=="shrine"||type=="entity"||type=="machine"){
                f["options"]=Json::array();if(type=="machine"){for(const auto& [id,m]:simulation_->machine_bodies())f["options"].push_back({{"id",id},{"label","기계 · "+number((m.position-fv(player_->get_position())).length())+"m"}});}
                else for(const auto& p:simulation_->poses())if((p.position-fv(player_->get_position())).length()<20)f["options"].push_back({{"id",p.id},{"label",content_.asset(p.asset_id).value("name",p.asset_id)}});
            }else if(type=="weapon"){
                f["options"]=Json::array();if(!f.value("required",true))f["options"].push_back({{"id",""},{"label","현재 장비 / 해제"}});
                for(const auto& w:view.value("armaments",Json::object()).value("weapons",Json::array()))f["options"].push_back({{"id",w["id"]},{"label",w.value("name",named(content_,w.value("patternId",std::string{})))+" · "+number(w.value("durability",0.0))}});
            }else if(type=="community_action")f["options"]=Json::array({{{"id","trade"},{"label","교환"}},{{"id","feed"},{"label","음식 건네기"}},{{"id","repair"},{"label","주민 수리"}},{{"id","rest"},{"label","휴식"}},{{"id","activity"},{"label","공동체 기여"}}});
            else if(type=="select"&&!f.contains("options")){
                if(key=="fluidType")f["options"]=Json::array({{{"id","liquid_mana"},{"label","액체 마나"}},{{"id","acid_fluid"},{"label","산성 유체"}}});
                else if(key=="origin")f["options"]=Json::array({{{"id","crafted"},{"label","소지한 설계도"}}});
            }else if(type=="energy")f["options"]=Json::array({{{"id","mechanical"},{"label","기계"}},{{"id","electrical"},{"label","전기"}},{{"id","thermal"},{"label","열"}},{{"id","chemical"},{"label","화학"}},{{"id","magic"},{"label","마나"}},{{"id","divine"},{"label","신성"}}});
            add_label(body,f.value("label",key),18);
            if(f.contains("options")&&f["options"].is_array()){
                auto input=memnew(OptionButton);int selected=-1;const Json preferred=f.value("default",Json());
                for(const auto& o:f["options"]){
                    const std::string id=o.is_string()?o.get<std::string>():o.is_number()?o.dump():o.value("id",std::string{});
                    input->add_item(gs(o.is_object()?o.value("label",named(content_,id)):named(content_,id)));
                    const Variant metadata=o.is_number()?Variant(o.get<double>()):Variant(gs(id));input->set_item_metadata(input->get_item_count()-1,metadata);
                    if(preferred.is_string()&&preferred.get<std::string>()==id)selected=input->get_item_count()-1;
                    else if(preferred.is_number()&&o.is_number()&&std::abs(preferred.get<double>()-o.get<double>())<1e-9)selected=input->get_item_count()-1;
                }
                if(input->get_item_count()>0)input->select(selected>=0?selected:0);
                body->add_child(input);form_inputs_[key]=input;
                if(type=="entity_id")input->connect("item_selected",Callable(this,"form_target_changed"));
            }
            else if(type=="number"||type=="integer"){auto input=memnew(SpinBox);input->set_min(f.value("min",0.0));input->set_max(f.value("max",100000.0));input->set_step(type=="integer"?1:.1);input->set_value(f.value("default",1.0));body->add_child(input);form_inputs_[key]=input;}
            else if(type=="boolean"){auto input=memnew(CheckButton);input->set_pressed(f.value("default",true));body->add_child(input);form_inputs_[key]=input;}
            else{auto input=memnew(LineEdit);input->set_text(gs(f.value("default",std::string{})));body->add_child(input);form_inputs_[key]=input;}
        }add_button(body,"실행","submit_form",{{"command",panel_args_.value("id",std::string{})}});
    }
    // Less frequent, authored game commands share native forms with meaningful labels and selectors.
    const std::set<std::string> internal={"inventory.grant","inventory.spend","simulation.pay","simulation.reward","resource.harvest","player.respawn","tools.wear","components.condition","placement.access","placement.damage","placement.mark_dynamic","energy.store","energy.consume","creature.spawn","creature.damage","boss.spawn","boss.damage","dungeon.ensure","first_signal.harvest","first_signal.relay","first_signal.ruin"};
    if(panel_!="machines"&&panel_!="faith"&&panel_!="community")for(const auto* source:{&view,&sim})if(source->contains("commands"))for(const auto& cmd:(*source)["commands"]){std::string domain=cmd.value("panel",std::string{});if(domain=="placement")domain="build";if(domain=="weapon")domain="equipment";if(domain=="dungeons"||domain=="bosses"||domain=="creatures")domain="explore";if(!internal.count(cmd.value("id",std::string{}))&&domain==panel_)add_button(body,cmd.value("label",std::string("사용")),"form",cmd);}
}
void FeralGame::render_result(Node* parent,const Json& data,int depth){
    if(depth>4)return;
    static const std::map<std::string,std::string> labels={{"name","이름"},{"label","내용"},{"message","알림"},{"description","설명"},{"detail","설명"},{"hp","체력"},{"maxHp","최대 체력"},{"durability","내구도"},{"maxDurability","최대 내구도"},{"damage","타격력"},{"cooldown","공격 간격"},{"range","도달 거리"},{"calories","식량"},{"work","작업량"},{"workCredits","작업 지식"},{"seconds","소요 시간"},{"progress","진행"},{"total","전체"},{"goal","목표"},{"count","수량"},{"amount","양"},{"capacity","용량"},{"amounts","보유 에너지"},{"cost","필요 재료"},{"inputs","필요 재료"},{"outputs","생산품"},{"items","물품"},{"inventory","가방"},{"energy","에너지"},{"mechanical","기계"},{"electrical","전기"},{"thermal","열"},{"chemical","화학"},{"magic","마나"},{"divine","신성"},{"rewardEU","보상 에너지"},{"status","현재 상태"},{"stations","작업대"},{"jobs","작업"},{"remainingS","남은 시간"},{"massKg","질량 · kg"},{"volumeLiters","부피 · L"},{"weapons","무기"},{"quote","제작 조건"},{"result","결과"},{"members","구성원"},{"cores","핵"},{"quests","의뢰"},{"phase","단계"},{"research","연구"},{"materials","재료"},{"required","필요"},{"health","상태"},{"entries","항목"},{"records","기록"},{"parts","부위"},{"member","신도 가입"},{"trial","시련"},{"contributions","기여"},{"recipes","제작법"},{"options","가능한 행동"}};
    if(data.is_array()){int count=0;for(const auto& row:data){if(++count>100){add_label(parent,"표시할 항목이 많습니다. 도감에서 분류를 좁혀 보세요.",17);break;}render_result(parent,row,depth+1);}return;}
    if(!data.is_object()){if(data.is_string())add_label(parent,named(content_,data.get<std::string>()),18);return;}
    for(auto it=data.begin();it!=data.end();++it){auto label=labels.find(it.key());std::string title=label==labels.end()?named(content_,it.key()):label->second;if(label==labels.end()&&title==it.key())continue;
        const auto& value=it.value();if(value.is_null())continue;if(value.is_number())add_label(parent,title+"   "+number(value.get<double>()),18);
        else if(value.is_boolean())add_label(parent,title+"   "+(value.get<bool>()?"예":"아니오"),18);
        else if(value.is_string()){std::string text=value.get<std::string>();static const std::map<std::string,std::string> states={{"available","시작 가능"},{"active","진행 중"},{"ready","수령 가능"},{"claimed","수령 완료"},{"completed","완료"},{"pending","대기 중"}};add_label(parent,title+"   "+(states.count(text)?states.at(text):named(content_,text)),18);}
        else if(!value.empty()){add_label(parent,title,22);render_result(parent,value,depth+1);}
    }
}
void FeralGame::profile_changed(double value,String path,String id){
    try{Json candidate=profiles_;auto pointer=Json::json_pointer(fs(path));auto& field=candidate["profiles"][fs(id)][pointer];if(field.is_number_integer())field=int(std::round(value));else field=value;actions_.configure(candidate);profiles_=std::move(candidate);if(timeline_)timeline_->configure(profiles_["profiles"][fs(id)]);}
    catch(const std::exception&e){if(panel_body_)add_label(panel_body_,e.what(),16);else notice(e.what());}
}
void FeralGame::preview_seek(double frame){
    preview_actions_.configure(profiles_);preview_actions_.reset();preview_actions_.begin({preview_profile_,ActorPose{}});preview_running_=false;
    for(int i=0;i<int(frame);i++)preview_actions_.advance(FIXED_DT,ActorPose{},[](const HitQuery&){return std::vector<ContactResult>{};},[](const ContactEvent&){});
    if(timeline_)timeline_->set_frame(frame);
}
void FeralGame::form_target_changed(int64_t index){
    if(panel_!="form"||index<0)return;
    Json updated=panel_args_;
    for(auto& field:updated["fields"]){
        const std::string key=field.value("key",std::string{});auto found=form_inputs_.find(key);if(found==form_inputs_.end())continue;
        if(auto* option=Object::cast_to<OptionButton>(found->second)){
            const int selected=option->get_selected();if(selected<0)continue;const Variant value=option->get_item_metadata(selected);
            if(value.get_type()==Variant::FLOAT||value.get_type()==Variant::INT)field["default"]=double(value);else field["default"]=fs(value);
        }else if(auto* spin=Object::cast_to<SpinBox>(found->second))field["default"]=spin->get_value();
        else if(auto* toggle=Object::cast_to<CheckButton>(found->second))field["default"]=toggle->is_pressed();
        else if(auto* text=Object::cast_to<LineEdit>(found->second))field["default"]=fs(text->get_text());
    }
    // Rebuild the form from the new target. Dependent part and room selectors are then
    // populated from that target's authored template while the other field values survive.
    show_panel("form",std::move(updated));
}
void FeralGame::ui_command(String command,String payload){
    try{
        std::string name=fs(command);Json args=Json::parse(fs(payload));
        if(name=="launcher"){show_launcher();return;}if(name=="new_world"){if(legacy_import_pending_)throw std::runtime_error(migration_error_.empty()?"기존 저장을 확인하고 있습니다. 잠시 후 다시 시작하세요.":"기존 저장 확인에 실패했습니다. 저장 가져오기를 다시 시도하세요.");show_create_world();return;}
        if(name=="retry_migration"){if(Engine::get_singleton()->has_singleton("FeralMigration")){legacy_import_pending_=true;migration_error_.clear();Engine::get_singleton()->get_singleton("FeralMigration")->call("start_import");show_launcher();}return;}
        if(name=="create_world"){
            if(legacy_import_pending_||storage_->legacy_import_status().value("exportFailed",false))throw std::runtime_error("기존 저장 가져오기를 먼저 완료하세요.");
            std::string preset=fs(preset_input_->get_item_metadata(preset_input_->get_selected()));std::string id="world-"+std::to_string(int64_t(Time::get_singleton()->get_unix_time_from_system()*1000));const auto& p=presets_["presets"][preset];
            int seed=int(Object::cast_to<SpinBox>(form_inputs_["seed"])->get_value());Json rules=p["rules"];for(auto [key,input]:form_inputs_)if(auto check=Object::cast_to<CheckButton>(input))rules[key]=check->is_pressed();std::string title=fs(name_input_->get_text().strip_edges());if(title.empty())title="새로운 세계";Json row={{"id",id},{"name",title},{"type",preset},{"seed",seed}};row["config"]={{"configVersion",1},{"preset",preset},{"seed",seed},{"terrain",{{"generator",p["terrain"]}}},{"rules",rules},{"modules",p.value("modules",Json::array())}};storage_->upsert_world(row);start_world(id);return;
        }
        if(name=="play"){start_world(args["id"]);return;}if(name=="resume"){if(playing_)build_hud();else show_launcher();return;}if(name=="leave"){close_world();return;}
        if(name=="respawn"){
            Vec3 p=fv(player_->get_position()),spawn{};std::string generator=config_["terrain"].value("generator",std::string("infinite"));if(generator=="frontier")spawn={std::round((p.x-77.5)/320)*320+77.5,0,std::round((p.z-84.5)/320)*320+84.5};else if(generator=="island")spawn={77.5,0,84.5};spawn.y=world_->surface_height(spawn.x,spawn.z)+1;
            auto result=gameplay_->command("player.respawn",{{"position",spawn}});if(result.value("ok",false)){player_->set_position(gv(spawn));player_->set_velocity({});fall_speed_=0;build_hud();}return;
        }
        if(name=="panel"){std::string panel=args["name"];show_panel(panel,args);return;}if(name=="save"){save_world();build_hud();notice("저장했습니다");return;}
        if(name=="attack.on"){input_state_.set_attack_source("ui",true);return;}if(name=="attack.off"){input_state_.set_attack_source("ui",false);return;}if(name=="jump"){input_state_.jump_queued=true;return;}if(name=="stance"){cycle_stance();return;}if(name=="interact"){interact();return;}
        if(name=="equip"){std::string id=args["id"];if(gameplay_->count(id)<1){notice("소지하지 않은 도구입니다");return;}held_=id;gameplay_->command("weapon.equip",{{"id",nullptr}});gameplay_->command("equipment.equip",{{"id",id}});sync_hand();build_hud();return;}
        if(name=="empty_hand"){held_.clear();gameplay_->command("weapon.equip",{{"id",nullptr}});sync_hand();build_hud();return;}
        if(name=="grip"){
            if(!gripped_.empty()){auto it=dynamics_.find(gripped_);if(it!=dynamics_.end()){double mass=it->second.body->get_mass(),speed=held_=="gripper"?std::min(8.0,4200/mass):std::min(5.0,1100/mass);it->second.body->apply_central_impulse(-camera_->get_global_basis().get_column(2)*speed*mass);}gripped_.clear();return;}
            auto a=actor_pose();auto hit=aim_contact(a.origin,feral::rotate(a.rotation,{0,0,-1}),held_=="gripper"?6.5:4);if(dynamics_.count(hit.id)&&!dynamics_[hit.id].body->is_freeze_enabled()){gripped_=hit.id;grip_distance_=held_=="gripper"?4:2.4;}return;
        }
        if(name=="toggle_visual"){visual_enabled_=!visual_enabled_;show_panel("actions");return;}
        if(name=="preview_action"){preview_seek(0);preview_running_=true;return;}
        if(name=="save_profiles"){write_json("user://action_profiles.json",profiles_);if(playing_)build_hud();else show_launcher();return;}
        if(name=="reset_profiles"){profiles_=read_json("res://data/action_profiles.json");actions_.configure(profiles_);show_panel("actions");return;}
        if(name=="save_settings"){for(auto [id,input]:form_inputs_)if(auto spin=Object::cast_to<SpinBox>(input))settings_[id]=spin->get_value();else if(auto check=Object::cast_to<CheckButton>(input))settings_[id]=check->is_pressed();settings_["viewDistance"]=int(settings_["viewDistance"].get<double>());settings_["visualAnimation"]=visual_enabled_;storage_->save_settings({{"schemaVersion",1},{"settings",settings_}});camera_->set_fov(settings_["fov"].get<double>());if(playing_)build_hud();else show_launcher();return;}
        if(name=="delete_world_confirm"){std::string id=args["id"];if(playing_&&world_id_==id)close_world();storage_->remove_world(id);show_launcher();return;}
        if(name=="save_world_settings"){auto row=storage_->find_world(args["id"]);if(!row)return;auto cfg=storage_->world_config(args["id"]);for(auto [id,input]:form_inputs_)cfg["rules"][id]=Object::cast_to<CheckButton>(input)->is_pressed();(*row)["config"]=cfg;if(name_input_&&!name_input_->get_text().strip_edges().is_empty())(*row)["name"]=fs(name_input_->get_text().strip_edges());storage_->upsert_world(*row);if(playing_&&world_id_==args["id"]){config_=cfg;world_->update_rules(cfg.value("rules",Json::object()));gameplay_->configure(cfg);simulation_->configure(cfg);build_hud();}else show_launcher();return;}
        if(name=="import_file"){migration_finished(name_input_->get_text(),"");return;}
        if(name=="release_page"){OS::get_singleton()->shell_open("https://github.com/Modopi/feral-voxel-sandbox/releases");return;}
        if(name=="check_update"||name=="download_update"||name=="install_update"||name=="install_permission"){
            if(!Engine::get_singleton()->has_singleton("FeralUpdates"))return;Object* bridge=Engine::get_singleton()->get_singleton("FeralUpdates");
            if(name=="check_update"){update_status_="새 버전을 확인하고 있습니다";bridge->call("check_latest");}
            else if(name=="download_update"){update_status_="다운로드를 시작합니다";bridge->call("download_latest_apk");}
            else if(name=="install_update"){if(playing_)save_world();bridge->call("open_installer");}
            else bridge->call("open_install_permission_settings");show_panel("updates");return;
        }
        if(name=="form"){show_panel("form",args);return;}
        if(name=="submit_form"){
            Json fields=Json::object();for(const auto& [key,input]:form_inputs_){if(auto option=Object::cast_to<OptionButton>(input)){if(option->get_selected()>=0){Variant value=option->get_item_metadata(option->get_selected());if(value.get_type()==Variant::FLOAT||value.get_type()==Variant::INT)fields[key]=double(value);else fields[key]=fs(value);}}else if(auto spin=Object::cast_to<SpinBox>(input))fields[key]=spin->get_value();else if(auto toggle=Object::cast_to<CheckButton>(input))fields[key]=toggle->is_pressed();else if(auto text=Object::cast_to<LineEdit>(input))fields[key]=fs(text->get_text());}
            for(const auto& field:panel_args_.value("fields",Json::array()))if((field.value("type",std::string{})=="position"||field.value("type",std::string{})=="vector3"))fields[field["key"].get<std::string>()]=aim_.hit?aim_.point:fv(player_->get_position());
            args={{"command",args["command"]},{"args",fields}};name="game";
        }
        if(name=="game"){if(args["command"]=="weapon.equip"&&args.value("args",Json::object()).value("id",std::string{})=="")args["args"]["id"]=nullptr;auto result=dispatch(args["command"],args.value("args",Json::object()));if(result.value("ok",false)){std::string cmd=args["command"];if(cmd=="weapon.equip"){held_.clear();sync_hand();}bool query=cmd.find("status")!=std::string::npos||cmd.find("quote")!=std::string::npos||cmd.find("evaluate")!=std::string::npos||cmd.find("options")!=std::string::npos||cmd=="progression.list"||cmd=="placement.list";if(query)show_panel("result",{{"result",result}});else{build_hud();notice(result.value("message",std::string("완료했습니다")));}}else add_label(panel_body_,result.value("message",result.value("reason",std::string("실행할 수 없습니다"))),18);return;}
    }catch(const std::exception&e){if(panel_body_)add_label(panel_body_,e.what(),18);else notice(e.what());}
}
void FeralGame::update_checked(String json,String error){
    if(error.is_empty())update_downloaded_=false;
    if(!error.is_empty())update_status_="업데이트를 확인하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.";
    else try{update_info_=Json::parse(fs(json));update_status_="배포 서명을 확인했습니다";}catch(...){update_status_="배포 정보를 읽을 수 없습니다";}
    if(panel_=="updates")show_panel("updates");
}
void FeralGame::update_progress(int64_t downloaded,int64_t total){
    update_status_="다운로드 중  "+number(downloaded/1048576.0)+" / "+number(total/1048576.0)+" MB";
    if(panel_=="updates"&&panel_body_){if(!toast_){toast_=memnew(Label);panel_body_->add_child(toast_);}toast_->set_text(gs(update_status_));}
}
void FeralGame::update_downloaded(String path,String error){
    update_downloaded_=error.is_empty()&&!path.is_empty();update_status_=update_downloaded_?"파일과 앱 서명을 확인했습니다. 준비되면 설치를 진행하세요.":"다운로드 검증에 실패했습니다. 기존 앱과 월드는 그대로 유지됩니다.";if(panel_=="updates")show_panel("updates");
}
void FeralGame::installer_result(String status,String error){
    update_status_=status=="permission_required"?"Android 설정에서 이 앱의 설치 허용을 켠 다음 다시 설치를 누르세요.":error.is_empty()?"Android 설치 화면에서 업데이트를 진행하세요.":"설치 화면을 열지 못했습니다. 다시 시도하세요.";if(panel_=="updates")show_panel("updates");
}
}
