#pragma once
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <tuple>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace feral {
using Json = nlohmann::json;
constexpr double CELL_M = 0.5;
constexpr double FIXED_DT = 1.0 / 60.0;
struct Vec3 {
    double x=0,y=0,z=0;
    double& operator[](size_t axis){if(axis>2)throw std::out_of_range("vector axis");return axis==0?x:axis==1?y:z;}
    double operator[](size_t axis)const{if(axis>2)throw std::out_of_range("vector axis");return axis==0?x:axis==1?y:z;}
    Vec3 operator+(Vec3 b) const{return {x+b.x,y+b.y,z+b.z};}
    Vec3 operator-(Vec3 b) const{return {x-b.x,y-b.y,z-b.z};}
    Vec3 operator*(double s) const{return {x*s,y*s,z*s};}
    Vec3 operator/(double s) const{return {x/s,y/s,z/s};}
    Vec3 &operator+=(Vec3 b){x+=b.x;y+=b.y;z+=b.z;return *this;}
    double dot(Vec3 b) const{return x*b.x+y*b.y+z*b.z;}
    Vec3 cross(Vec3 b) const{return {y*b.z-z*b.y,z*b.x-x*b.z,x*b.y-y*b.x};}
    double length_squared() const{return dot(*this);}
    double length() const{return std::sqrt(length_squared());}
    Vec3 normalized() const{double n=length();return n>1e-12?*this/n:Vec3{};}
};
inline void to_json(Json& j,const Vec3& v){j={{"x",v.x},{"y",v.y},{"z",v.z}};}
inline void from_json(const Json& j,Vec3& v){if(j.is_array()&&j.size()>=3)v={j[0].get<double>(),j[1].get<double>(),j[2].get<double>()};else if(j.is_object())v={j.value("x",0.0),j.value("y",0.0),j.value("z",0.0)};}
struct Quat {double x=0,y=0,z=0,w=1;};
inline void to_json(Json& j,const Quat& q){j={{"x",q.x},{"y",q.y},{"z",q.z},{"w",q.w}};}
inline void from_json(const Json& j,Quat& q){if(j.is_object())q={j.value("x",0.0),j.value("y",0.0),j.value("z",0.0),j.value("w",1.0)};}
inline Vec3 rotate(Quat q,Vec3 v){Vec3 u{q.x,q.y,q.z};Vec3 t=u.cross(v)*2;return v+t*q.w+u.cross(t);}
struct Cell {
    int x=0,y=0,z=0;
    bool operator==(const Cell& c)const{return x==c.x&&y==c.y&&z==c.z;}
    bool operator<(const Cell& c)const{return std::tie(x,y,z)<std::tie(c.x,c.y,c.z);}
    Cell operator+(Cell c)const{return{x+c.x,y+c.y,z+c.z};}
};
struct CellHash{size_t operator()(Cell c)const{return uint64_t(uint32_t(c.x))*73856093ULL ^ uint64_t(uint32_t(c.y))*19349663ULL ^ uint64_t(uint32_t(c.z))*83492791ULL;}};
inline void to_json(Json& j,const Cell& c){j=Json::array({c.x,c.y,c.z});}
inline void from_json(const Json& j,Cell& c){if(j.is_array()&&j.size()>=3)c={j[0].get<int>(),j[1].get<int>(),j[2].get<int>()};else if(j.is_object())c={j.value("x",0),j.value("y",0),j.value("z",0)};}
inline Cell world_cell(Vec3 p){return {int(std::floor(p.x/CELL_M)),int(std::floor(p.y/CELL_M)),int(std::floor(p.z/CELL_M))};}
inline Vec3 cell_center(Cell c){return {(c.x+.5)*CELL_M,(c.y+.5)*CELL_M,(c.z+.5)*CELL_M};}
inline std::string cell_key(Cell c){return std::to_string(c.x)+","+std::to_string(c.y)+","+std::to_string(c.z);}
struct Box {Vec3 center,size;std::string material;double mass=0;bool solid=true;};
struct Voxel {Cell cell;std::string block;double hp=-1;};
struct BodyState {std::string id;Vec3 position,velocity,angular_velocity;Quat rotation;bool anchored=false;uint64_t revision=0;std::vector<Voxel> voxels;std::vector<Box> boxes;double mass=0;};
struct Contact {bool hit=false;std::string kind,id,part,material;Vec3 point,normal;Cell cell;double distance=0;};
inline Json ok(Json extra=Json::object()){extra["ok"]=true;return extra;}
inline Json fail(const std::string& reason){return {{"ok",false},{"reason",reason}};}
inline const Json& empty_object(){static const Json value=Json::object();return value;}
// Canonical exported CONTENT: category -> {entries:[...]}; assets keyed by authored asset ID.
struct Content {
    Json data=Json::object(),assets=Json::object();
    std::unordered_map<std::string,Json> entries;
    mutable std::unordered_map<std::string,double> authored_asset_radius_cache;
    void index(){entries.clear();authored_asset_radius_cache.clear();for(auto it=data.begin();it!=data.end();++it){const auto& t=it.value();if(t.is_object()&&t.contains("entries")&&t["entries"].is_array())for(const auto& row:t["entries"])if(row.is_object()&&row.contains("id"))entries[row["id"].get<std::string>()]=row;}}
    const Json& find(const std::string& id)const{auto it=entries.find(id);return it==entries.end()?empty_object():it->second;}
    const Json& find(const std::string& category,const std::string& id)const{if(data.contains(category)&&data.at(category).contains("entries"))for(const auto& row:data.at(category).at("entries"))if(row.value("id",std::string{})==id)return row;return empty_object();}
    const Json& asset(const std::string& id)const{return assets.contains(id)?assets.at(id):empty_object();}
};
}
