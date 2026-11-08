#pragma once

#include "common.hpp"

namespace feral::contact_geometry {

// A local box attached to an optional uniform-scale rigid transform. This stays independent of
// Godot so the adapter's manual contact path and headless regression tests can share geometry.
struct OrientedBox {
    Box box;
    Vec3 translation;
    Quat rotation;
    double uniform_scale = 1;
};

struct BoxSweepHit {
    size_t box_index = 0;
    double fraction = 0;
    Vec3 query_center;
    Vec3 surface_point;
    Vec3 normal;
};

inline Vec3 component_clamp(Vec3 point, Vec3 center, Vec3 size) {
    const Vec3 half = size * 0.5;
    return {
        std::clamp(point.x, center.x-half.x, center.x+half.x),
        std::clamp(point.y, center.y-half.y, center.y+half.y),
        std::clamp(point.z, center.z-half.z, center.z+half.z)
    };
}

// Sweeps a sphere along a segment against an axis-aligned box. The slab intersection supplies a
// bounded interval; distance minimization against the original box removes rounded-corner false
// positives from the inflated broad-phase box.
inline bool swept_box(Vec3 from, Vec3 to, double radius, Vec3 center, Vec3 size,
                      double& fraction, Vec3& normal) {
    if (!std::isfinite(radius) || radius < 0 || size.x <= 0 || size.y <= 0 || size.z <= 0) return false;
    const Vec3 delta = to-from;
    const Vec3 half = size*0.5;
    const Vec3 lo = center-half;
    const Vec3 hi = center+half;
    double enter=0, leave=1;
    int axis_hit=-1;
    double sign=0;
    auto at=[](Vec3 a,int axis){return axis==0?a.x:axis==1?a.y:a.z;};
    for(int axis=0;axis<3;axis++){
        const double p=at(from,axis),s=at(delta,axis),l=at(lo,axis)-radius,h=at(hi,axis)+radius;
        if(std::abs(s)<1e-12){if(p<l||p>h)return false;continue;}
        double t1=(l-p)/s,t2=(h-p)/s,face_sign=-1;
        if(t1>t2){std::swap(t1,t2);face_sign=1;}
        if(t1>enter){enter=t1;axis_hit=axis;sign=face_sign;}
        leave=std::min(leave,t2);
        if(enter>leave)return false;
    }
    auto distance_squared=[&](double t){
        const Vec3 point=from+delta*t;
        double sum=0;
        for(int axis=0;axis<3;axis++){
            const double value=at(point,axis),minimum=at(lo,axis),maximum=at(hi,axis);
            const double error=value-std::clamp(value,minimum,maximum);
            sum+=error*error;
        }
        return sum;
    };
    double left=enter,right=leave;
    for(int i=0;i<24;i++){
        const double a=(2*left+right)/3,b=(left+2*right)/3;
        if(distance_squared(a)<distance_squared(b))right=b;else left=a;
    }
    const double closest=(left+right)*0.5;
    if(distance_squared(closest)>radius*radius+1e-9)return false;
    left=enter;right=closest;
    for(int i=0;i<24;i++){
        const double middle=(left+right)*0.5;
        if(distance_squared(middle)<=radius*radius+1e-9)right=middle;else left=middle;
    }
    fraction=std::clamp(right,0.0,1.0);
    normal={};
    if(axis_hit==0)normal.x=sign;
    if(axis_hit==1)normal.y=sign;
    if(axis_hit==2)normal.z=sign;
    return true;
}

inline double arc_sagitta_padding(double lever_radius,double angle_radians) {
    if (!std::isfinite(lever_radius)||!std::isfinite(angle_radians)||lever_radius<=0||angle_radians<=0) return 0;
    return lever_radius*(1.0-std::cos(std::min(3.14159265358979323846,angle_radians)/2.0));
}

inline Quat normalized(Quat q) {
    const double length=std::sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w);
    return length>1e-12?Quat{q.x/length,q.y/length,q.z/length,q.w/length}:Quat{};
}

inline Vec3 inverse_rotate(Quat q,Vec3 point) {
    q=normalized(q);
    return rotate({-q.x,-q.y,-q.z,q.w},point);
}

inline Vec3 world_point(const OrientedBox& shape,Vec3 local) {
    return shape.translation+rotate(normalized(shape.rotation),local*shape.uniform_scale);
}

inline bool swept_oriented_box(Vec3 from,Vec3 to,double radius,const OrientedBox& shape,
                               double& fraction,Vec3& world_normal,Vec3& world_surface_point) {
    if (!std::isfinite(shape.uniform_scale)||shape.uniform_scale<=1e-9) return false;
    const Vec3 local_from=inverse_rotate(shape.rotation,from-shape.translation)/shape.uniform_scale;
    const Vec3 local_to=inverse_rotate(shape.rotation,to-shape.translation)/shape.uniform_scale;
    Vec3 local_normal;
    if (!swept_box(local_from,local_to,radius/shape.uniform_scale,shape.box.center,shape.box.size,
                   fraction,local_normal)) return false;
    const Vec3 local_center=local_from+(local_to-local_from)*fraction;
    world_normal=rotate(normalized(shape.rotation),local_normal).normalized();
    world_surface_point=world_point(shape,component_clamp(local_center,shape.box.center,shape.box.size));
    return true;
}

inline std::vector<BoxSweepHit> swept_boxes(Vec3 from,Vec3 to,double radius,
                                             const std::vector<OrientedBox>& boxes) {
    std::vector<BoxSweepHit> hits;
    hits.reserve(boxes.size());
    for(size_t index=0;index<boxes.size();index++){
        double fraction=0;
        Vec3 normal,surface;
        if(!swept_oriented_box(from,to,radius,boxes[index],fraction,normal,surface))continue;
        hits.push_back({index,fraction,from+(to-from)*fraction,surface,normal});
    }
    std::stable_sort(hits.begin(),hits.end(),[](const BoxSweepHit& a,const BoxSweepHit& b){
        return a.fraction<b.fraction;
    });
    return hits;
}

inline bool blocked_by_boxes(Vec3 origin,Vec3 target_point,const std::vector<OrientedBox>& boxes,
                             size_t target_box,double target_radius=0,double surface_margin=0.035) {
    const Vec3 ray=target_point-origin;
    const double distance=ray.length();
    if(distance<=1e-9)return false;
    for(size_t index=0;index<boxes.size();index++){
        if(index==target_box)continue;
        double fraction=0;
        Vec3 normal,surface;
        if(swept_oriented_box(origin,target_point,0,boxes[index],fraction,normal,surface)&&
           fraction*distance<distance-target_radius-surface_margin)return true;
    }
    return false;
}

// Matches a point attack's two stages: raycast to the first surface, then gather nearby boxes in
// the impact sphere and reject candidates hidden behind another box. Results are nearest first.
inline std::vector<BoxSweepHit> point_impact_candidates(Vec3 origin,Vec3 direction,double reach,
                                                        double radius,const std::vector<OrientedBox>& boxes,
                                                        double surface_margin=0.035) {
    std::vector<BoxSweepHit> visible;
    const Vec3 aim=direction.normalized();
    if(aim.length_squared()<1e-12||reach<=0||radius<0)return visible;
    const auto ray_hits=swept_boxes(origin,origin+aim*reach,0,boxes);
    if(ray_hits.empty())return visible;
    const BoxSweepHit& anchor=ray_hits.front();
    const Vec3 impact_center=anchor.surface_point+aim*0.002;
    for(const BoxSweepHit& candidate:swept_boxes(impact_center,impact_center,radius,boxes)){
        const double distance=(candidate.surface_point-origin).length();
        if(distance>reach+radius)continue;
        if(blocked_by_boxes(origin,candidate.surface_point,boxes,candidate.box_index,radius,surface_margin))continue;
        visible.push_back(candidate);
    }
    std::stable_sort(visible.begin(),visible.end(),[origin](const BoxSweepHit& a,const BoxSweepHit& b){
        return (a.surface_point-origin).length_squared()<(b.surface_point-origin).length_squared();
    });
    return visible;
}

} // namespace feral::contact_geometry
