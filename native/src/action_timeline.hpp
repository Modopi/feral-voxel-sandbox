#pragma once
#include "common.hpp"
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/classes/font.hpp>
#include <godot_cpp/classes/text_server.hpp>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/core/class_db.hpp>
namespace feral {
class ActionTimeline : public godot::Control {
    GDCLASS(ActionTimeline,godot::Control)
    Json profile_;
    double frame_=0;
protected:
    static void _bind_methods(){ADD_SIGNAL(godot::MethodInfo("frame_selected",godot::PropertyInfo(godot::Variant::FLOAT,"frame")));}
public:
    void configure(Json profile){profile_=std::move(profile);set_custom_minimum_size({500,155});queue_redraw();}
    void set_frame(double frame){frame_=frame;queue_redraw();}
    void _draw()override{
        using namespace godot;if(profile_.empty())return;double duration=profile_.value("durationFrames",30.0);float left=110,width=get_size().x-left-20;
        auto font=get_theme_default_font();Color muted(.4,.5,.45),text(.89,.91,.84),gold(.87,.7,.35);
        draw_string(font,{0,48},String::utf8("화면 동작"),HORIZONTAL_ALIGNMENT_LEFT,-1,18,text);draw_string(font,{0,106},String::utf8("물리 판정"),HORIZONTAL_ALIGNMENT_LEFT,-1,18,text);
        for(int y:{42,100})draw_line({left,float(y)},{left+width,float(y)},muted,3);
        for(const auto& key:profile_.value("visual",Json::array()))draw_circle({left+float(key.value("frame",0.0)/duration*width),42},5,Color(.55,.76,.7));
        for(const auto& hit:profile_.value("hitboxes",Json::array())){
            if(hit.value("kind",std::string{})=="point"){float x=left+hit.value("hitFrame",0.0)/duration*width;draw_line({x,84},{x,116},gold,5);}
            else{float a=left+hit.value("activeStartFrame",0.0)/duration*width,b=left+hit.value("activeEndFrame",duration)/duration*width;draw_rect(Rect2(a,89,b-a,22),Color(.7,.5,.17,.5));for(const auto& key:hit.value("keyframes",Json::array()))draw_circle({left+float(key.value("frame",0.0)/duration*width),100},4,gold);}
        }
        for(int i=0;i<=int(duration);i+=5){float x=left+i/duration*width;draw_line({x,125},{x,131},muted);draw_string(font,{x-4,150},String::num_int64(i),HORIZONTAL_ALIGNMENT_LEFT,-1,14,text);}
        float marker=left+frame_/duration*width;draw_line({marker,20},{marker,120},Color(.95,.93,.76),2);
    }
    void _gui_input(const godot::Ref<godot::InputEvent>& event)override{
        godot::Ref<godot::InputEventMouseButton> mouse=event;if(mouse.is_valid()&&mouse->is_pressed()){double duration=profile_.value("durationFrames",30.0);frame_=std::clamp((mouse->get_position().x-110)/(get_size().x-130)*duration,0.0,duration);emit_signal("frame_selected",frame_);queue_redraw();accept_event();}
    }
};
}
