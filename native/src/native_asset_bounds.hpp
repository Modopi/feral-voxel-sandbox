#pragma once

#include "common.hpp"

namespace feral {
namespace asset_bounds_detail {

inline Vec3 point(const Json& value,Vec3 fallback={}){
    if(value.is_array()&&value.size()>=3&&value[0].is_number()&&value[1].is_number()&&value[2].is_number())
        return {value[0].get<double>(),value[1].get<double>(),value[2].get<double>()};
    if(value.is_object())return {value.value("x",fallback.x),value.value("y",fallback.y),value.value("z",fallback.z)};
    return fallback;
}

inline double maximum_scale(const Json& value){
    if(value.is_number())return std::abs(value.get<double>());
    const Vec3 scale=point(value,{1,1,1});
    return std::max({std::abs(scale.x),std::abs(scale.y),std::abs(scale.z)});
}

inline double asset_radius(const Content& content,const std::string& id,std::set<std::string>& stack,int depth){
    if(id.empty()||depth>=8||stack.count(id))return 0;
    const Json& model=content.asset(id);if(model.empty())return 0;
    stack.insert(id);
    std::map<std::string,Json> parts;
    for(const auto& part:model.value("parts",Json::array()))if(part.is_object()&&part.value("id",std::string{}).size())
        parts[part.value("id",std::string{})]=part;
    std::map<std::string,double> chain_cache;
    std::set<std::string> visiting;
    std::function<double(const std::string&)> chain_length=[&](const std::string& part_id)->double{
        if(chain_cache.count(part_id))return chain_cache.at(part_id);
        auto found=parts.find(part_id);if(found==parts.end()||visiting.count(part_id))return 0;
        visiting.insert(part_id);const Vec3 translation=point(found->second.value("translation",Json::array({0,0,0})));
        double result=translation.length();const Json parent=found->second.value("parent",Json());
        if(parent.is_string())result+=chain_length(parent.get<std::string>());
        visiting.erase(part_id);chain_cache[part_id]=result;return result;
    };
    double radius=0;
    for(const auto& [part_id,part]:parts){
        const double reach=chain_length(part_id);const Json boxes=part.value("boxes",Json::array());
        for(const auto& box:boxes){const Vec3 center=point(box.value("center",Json::array({0,0,0}))),size=point(box.value("size",Json::array({0,0,0})));radius=std::max(radius,reach+center.length()+size.length()*.5);}
    }
    for(const auto& instance:model.value("instances",Json::array())){
        const std::string child=instance.value("assetId",std::string{});const Json offset=instance.contains("translation")?instance["translation"]:instance.value("position",Json::array({0,0,0}));
        const double child_radius=asset_radius(content,child,stack,depth+1);
        radius=std::max(radius,point(offset).length()+maximum_scale(instance.value("scale",Json::array({1,1,1})))*child_radius);
    }
    stack.erase(id);return radius;
}

} // namespace asset_bounds_detail

// Conservative radial bound around an authored asset root. Parent-chain translation lengths
// plus each box's center and half-diagonal remain valid under arbitrary joint rotations. Nested
// instances add their own offsets and scale their child bounds; the stack/depth guard mirrors the
// renderer's protection from cyclic authored references.
inline double authored_asset_radius(const Content& content,const std::string& asset_id){
    if(auto cached=content.authored_asset_radius_cache.find(asset_id);cached!=content.authored_asset_radius_cache.end())return cached->second;
    std::set<std::string> stack;const double radius=asset_bounds_detail::asset_radius(content,asset_id,stack,0);
    content.authored_asset_radius_cache[asset_id]=radius;return radius;
}

inline double segment_distance_squared(Vec3 point,Vec3 from,Vec3 to){
    const Vec3 delta=to-from;const double length=delta.length_squared();
    const double t=length>1e-12?std::clamp((point-from).dot(delta)/length,0.0,1.0):0.0;
    return (point-(from+delta*t)).length_squared();
}

inline bool segment_overlaps_sphere(Vec3 center,Vec3 from,Vec3 to,double radius){
    return segment_distance_squared(center,from,to)<=radius*radius;
}

} // namespace feral
