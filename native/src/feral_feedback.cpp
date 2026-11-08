#include "feral_game.hpp"
#include <godot_cpp/classes/audio_stream_wav.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>

namespace feral {
using namespace godot;

void FeralGame::play_impact(){
    if(!settings_.value("sound",true)||clock_-audio_at_<.07)return;
    audio_at_=clock_;
    if(!impact_audio_){
        impact_audio_=memnew(AudioStreamPlayer);add_child(impact_audio_);
        Ref<AudioStreamWAV> sound;sound.instantiate();sound->set_format(AudioStreamWAV::FORMAT_16_BITS);sound->set_mix_rate(24000);
        PackedByteArray bytes;bytes.resize(4800);uint32_t random=78219;
        for(int i=0;i<2400;i++){random=random*1664525+1013904223;double t=i/24000.0;double envelope=std::exp(-t*65);int16_t value=int16_t((std::sin(t*1050)*.35+(double(random&65535)/32768-1)*.65)*envelope*13000);bytes.set(i*2,uint16_t(value)&255);bytes.set(i*2+1,(uint16_t(value)>>8)&255);}
        sound->set_data(bytes);impact_audio_->set_stream(sound);impact_audio_->set_max_polyphony(4);impact_audio_->set_volume_db(-8);
    }impact_audio_->play();
}

void FeralGame::consume_feedback(){
    for(auto it=feedback_marks_.begin();it!=feedback_marks_.end();)if(it->expires<=clock_){it->mesh->queue_free();it=feedback_marks_.erase(it);}else++it;
    for(const auto& event:simulation_->consume_events()){
        const std::string type=event.value("type",std::string{});
        if(type=="player_hit"){
            play_impact();if(event.contains("status")&&event["status"].is_object()&&event["status"].value("type",std::string{})=="slow")slow_until_=clock_+event["status"].value("seconds",2.0);
            continue; // Gameplay already applied authoritative HP damage.
        }
        if(type=="attack_telegraph"){notice(event.value("text",std::string("공격을 피하세요")));continue;}
        if(type=="boss_telegraph"&&event.contains("shape")){
            const auto& shape=event["shape"];Vec3 center=shape.value("center",Json::object()).get<Vec3>();const std::string kind=shape.value("kind",std::string{});
            PackedVector3Array vertices,normals;PackedColorArray colors;
            auto triangle=[&](Vec3 a,Vec3 b,Vec3 c){for(auto p:{a,b,c}){p.y=std::max(p.y,world_->surface_height(p.x,p.z)+.025);vertices.push_back(gv(p));normals.push_back(Vector3(0,1,0));colors.push_back(Color(.95,.18,.07,.42));}};
            center.y=shape.value("bottomY",center.y-.5);
            if(kind=="sphere"||kind=="cylinder"||kind=="annular_cylinder"){
                double outer=shape.value("outerRadiusM",shape.value("radiusM",1.0)),inner=shape.value("innerRadiusM",0.0);
                for(int i=0;i<64;i++){double a=i*6.283185307179586/64,b=(i+1)*6.283185307179586/64;Vec3 v0{std::sin(a),0,std::cos(a)},v1{std::sin(b),0,std::cos(b)};triangle(center+v0*inner,center+v0*outer,center+v1*outer);if(inner>0)triangle(center+v0*inner,center+v1*outer,center+v1*inner);}
            }else if(shape.contains("axes")&&shape["axes"].size()>=3&&shape.contains("halfSize")){
                Vec3 x=shape["axes"][0].get<Vec3>()*shape["halfSize"][0].get<double>(),z=shape["axes"][2].get<Vec3>()*shape["halfSize"][2].get<double>();triangle(center-x-z,center+x-z,center+x+z);triangle(center-x-z,center+x+z,center-x+z);
            }
            if(vertices.size()){Array arrays;arrays.resize(Mesh::ARRAY_MAX);arrays[Mesh::ARRAY_VERTEX]=vertices;arrays[Mesh::ARRAY_NORMAL]=normals;arrays[Mesh::ARRAY_COLOR]=colors;Ref<ArrayMesh> mesh;mesh.instantiate();mesh->add_surface_from_arrays(Mesh::PRIMITIVE_TRIANGLES,arrays);auto node=memnew(MeshInstance3D);node->set_mesh(mesh);node->set_material_override(fluid_material_);node->set_cast_shadows_setting(GeometryInstance3D::SHADOW_CASTING_SETTING_OFF);world_root_->add_child(node);feedback_marks_.push_back({node,clock_+event.value("duration",1.0)});}
            notice("표시된 공격 범위를 피하세요");continue;
        }
        if(settings_.value("showEvents",false)){
            if(type=="field_harvest")notice("자원을 채집했습니다");
            else if(type=="boss_defeated")notice("수호자를 쓰러뜨렸습니다");
            else if(type=="dungeon_discovered")notice("새로운 유적을 발견했습니다");
        }
    }
    for(const auto& event:gameplay_->drain_events())if(event.value("type",std::string{})=="player_died"){held_.clear();gripped_.clear();exit_machine();sync_hand();}
}
}
