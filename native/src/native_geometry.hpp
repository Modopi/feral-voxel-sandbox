#pragma once
#include "world.hpp"
#include "contact_geometry.hpp"
#include <godot_cpp/classes/array_mesh.hpp>
#include <godot_cpp/classes/standard_material3d.hpp>
#include <godot_cpp/variant/packed_vector3_array.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>

namespace feral {
inline godot::Vector3 gv(Vec3 v){return {godot::real_t(v.x),godot::real_t(v.y),godot::real_t(v.z)};}
inline Vec3 fv(godot::Vector3 v){return {v.x,v.y,v.z};}
inline godot::Quaternion gq(Quat q){return {godot::real_t(q.x),godot::real_t(q.y),godot::real_t(q.z),godot::real_t(q.w)};}
inline Quat fq(godot::Quaternion q){return {q.x,q.y,q.z,q.w};}
inline godot::String gs(const std::string& s){return godot::String::utf8(s.c_str());}
inline std::string fs(const godot::String& s){return s.utf8().get_data();}

struct DrawBox {Box box;godot::Color color;std::string part;};
inline godot::Color material_color(const Content& c,const std::string& id){
    const auto& b=c.find("blocks",id);
    if(b.contains("color")&&b["color"].is_string())return godot::Color::html(gs(b["color"].get<std::string>()));
    if(id=="grass")return {0.34,0.48,0.24};if(id=="log"||id=="wood"||id=="plank")return {0.44,0.29,0.16};
    if(id=="leaves")return {0.24,0.43,0.2};if(id=="dirt"||id=="soil")return {.39,.28,.19};
    if(id=="sand")return {.69,.64,.44};if(id.find("ore")!=std::string::npos)return {.42,.5,.53};
    return {.43,.45,.43};
}

// Exact visible surface extraction. Neighbor boxes remove only the overlapping face rectangle;
// separate articulated parts never occlude each other in this cache.
inline godot::Ref<godot::ArrayMesh> boxes_mesh(const std::vector<DrawBox>& boxes){
    using namespace godot;
    PackedVector3Array vertices,normals;PackedColorArray colors;PackedInt32Array indices;
    auto component=[](Vec3 v,int a){return a==0?v.x:a==1?v.y:v.z;};
    struct Rect{double a,b,c,d;};
    for(size_t n=0;n<boxes.size();n++){
        const auto& src=boxes[n];Vec3 lo=src.box.center-src.box.size*.5,hi=src.box.center+src.box.size*.5;
        for(int axis=0;axis<3;axis++)for(int side:{-1,1}){
            int u=(axis+1)%3,v=(axis+2)%3;double plane=component(side<0?lo:hi,axis);
            std::vector<Rect> faces{{component(lo,u),component(hi,u),component(lo,v),component(hi,v)}};
            for(size_t j=0;j<boxes.size()&&!faces.empty();j++)if(j!=n&&boxes[j].color.a>=.999){
                Vec3 bl=boxes[j].box.center-boxes[j].box.size*.5,bh=boxes[j].box.center+boxes[j].box.size*.5;
                double nl=component(bl,axis),nh=component(bh,axis);
                if(side>0?!(nl<=plane+1e-7&&nh>plane+1e-7):!(nh>=plane-1e-7&&nl<plane-1e-7))continue;
                Rect cut{component(bl,u),component(bh,u),component(bl,v),component(bh,v)};std::vector<Rect> next;
                for(auto r:faces){double a=std::max(r.a,cut.a),b=std::min(r.b,cut.b),c=std::max(r.c,cut.c),d=std::min(r.d,cut.d);
                    if(a>=b-1e-8||c>=d-1e-8){next.push_back(r);continue;}
                    if(r.a<a-1e-8)next.push_back({r.a,a,r.c,r.d});if(b<r.b-1e-8)next.push_back({b,r.b,r.c,r.d});
                    if(r.c<c-1e-8)next.push_back({a,b,r.c,c});if(d<r.d-1e-8)next.push_back({a,b,d,r.d});
                }faces.swap(next);
            }
            for(auto r:faces){int start=vertices.size();Vector3 normal;normal[axis]=side;
                for(auto pair:std::array<std::array<double,2>,4>{{{{r.a,r.c}},{{r.b,r.c}},{{r.b,r.d}},{{r.a,r.d}}}}){Vector3 p;p[axis]=plane;p[u]=pair[0];p[v]=pair[1];vertices.push_back(p);normals.push_back(normal);colors.push_back(src.color);}
                // Godot uses clockwise front faces.
                for(int k:side>0?std::array<int,6>{0,2,1,0,3,2}:std::array<int,6>{0,1,2,0,2,3})indices.push_back(start+k);
            }
        }
    }
    Ref<ArrayMesh> mesh;mesh.instantiate();if(vertices.is_empty())return mesh;
    Array arrays;arrays.resize(Mesh::ARRAY_MAX);arrays[Mesh::ARRAY_VERTEX]=vertices;arrays[Mesh::ARRAY_NORMAL]=normals;arrays[Mesh::ARRAY_COLOR]=colors;arrays[Mesh::ARRAY_INDEX]=indices;
    mesh->add_surface_from_arrays(Mesh::PRIMITIVE_TRIANGLES,arrays);return mesh;
}
inline godot::Ref<godot::ArrayMesh> terrain_mesh(const MeshData& data){
    using namespace godot;Ref<ArrayMesh> mesh;mesh.instantiate();if(data.vertices.empty())return mesh;
    PackedVector3Array v,n;PackedColorArray c;PackedInt32Array i;
    for(auto p:data.vertices)v.push_back(gv(p));for(auto p:data.normals)n.push_back(gv(p));for(auto p:data.colors)c.push_back(Color(p.x,p.y,p.z));
    // World mesh emitters use conventional outward CCW quads. Godot treats
    // clockwise triangles as front faces, so reverse each triangle here while
    // keeping its explicitly authored outward normal unchanged.
    for(size_t k=0;k+2<data.indices.size();k+=3){i.push_back(data.indices[k]);i.push_back(data.indices[k+2]);i.push_back(data.indices[k+1]);}
    Array a;a.resize(Mesh::ARRAY_MAX);a[Mesh::ARRAY_VERTEX]=v;a[Mesh::ARRAY_NORMAL]=n;a[Mesh::ARRAY_COLOR]=c;a[Mesh::ARRAY_INDEX]=i;
    mesh->add_surface_from_arrays(Mesh::PRIMITIVE_TRIANGLES,a);return mesh;
}

using contact_geometry::swept_box;
}
