#include "contact_geometry.hpp"
#include "native_asset_bounds.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

using namespace feral;
using namespace feral::contact_geometry;

namespace {

OrientedBox box(Vec3 center,Vec3 size,Vec3 translation={},Quat rotation={},double scale=1) {
    OrientedBox shape;
    shape.box.center=center;
    shape.box.size=size;
    shape.translation=translation;
    shape.rotation=rotation;
    shape.uniform_scale=scale;
    return shape;
}

Quat yaw(double degrees) {
    const double half=degrees*3.14159265358979323846/360.0;
    return {0,std::sin(half),0,std::cos(half)};
}

void hollow_asset_keeps_its_open_space() {
    const std::vector<OrientedBox> ring{
        box({-1.25,0,0},{.5,2,3}), box({1.25,0,0},{.5,2,3}),
        box({0,.75,0},{2,.5,3}), box({0,-.75,0},{2,.5,3})
    };
    const auto through_hole=swept_boxes({0,0,-2},{0,0,2},.4,ring);
    assert(through_hole.empty());
    const auto against_wall=swept_boxes({-2,0,0},{2,0,0},.1,ring);
    assert(!against_wall.empty());
}

void rotated_and_scaled_boxes_use_body_local_coordinates() {
    const OrientedBox blade=box({0,0,0},{2,.2,.2},{3,0,0},yaw(90),1.5);
    double fraction=0;
    Vec3 normal,surface;
    assert(swept_oriented_box({1,0,1.1},{5,0,1.1},.02,blade,fraction,normal,surface));
    assert(fraction>0&&fraction<1);
    assert(normal.length_squared()>.9);
    // The unrotated local thin axis lies along world Z after a 90 degree yaw; this offset is outside
    // the unrotated box but within the rotated, scaled blade.
    assert(std::abs(surface.z-1.1)<.2);
}

void point_volume_finds_adjacent_cells_on_first_surface() {
    std::vector<OrientedBox> boxes{
        box({-.25,0,-2},{.5,.5,.5}),
        box({.25,0,-2},{.5,.5,.5}),
        box({-.25,0,-2.5},{.5,.5,.5})
    };
    const auto hits=point_impact_candidates({0,0,0},{0,0,-1},5,.30,boxes);
    assert(hits.size()==2);
    assert(hits[0].box_index<2&&hits[1].box_index<2);
    assert(std::abs(hits[0].surface_point.z+1.752)<1e-6);
    assert(std::abs(hits[1].surface_point.z+1.752)<1e-6);
}

void point_impact_cannot_damage_through_a_wall() {
    const std::vector<OrientedBox> boxes{
        box({0,0,-2},{2,2,.5}), // first struck wall
        box({0,0,-5},{2,2,.5})  // hidden target behind it
    };
    const auto hits=point_impact_candidates({0,0,0},{0,0,-1},8,.28,boxes);
    assert(hits.size()==1&&hits.front().box_index==0);
    assert(blocked_by_boxes({0,0,0},{0,0,-4.75},boxes,1,.28));
}

void swept_sphere_checks_rounded_box_corners() {
    double fraction=0;
    Vec3 normal;
    // The expanded slab admits this corner, but the closest-point distance is outside the sphere.
    assert(!swept_box({-.8,0,-.8},{-.8,0,-.8},.4,{0,0,0},{1,1,1},fraction,normal));
    assert(swept_box({-.75,0,-.75},{-.75,0,-.75},.4,{0,0,0},{1,1,1},fraction,normal));
}

void arc_sagitta_covers_targets_between_rotational_samples() {
    const double pi=3.14159265358979323846;
    const double radius=2.0,angle=pi/8;
    const Vec3 from{radius,0,0};
    const Vec3 to{radius*std::cos(angle),radius*std::sin(angle),0};
    const Vec3 target{radius*std::cos(angle/2),radius*std::sin(angle/2),0};
    const Vec3 target_box{.01,.01,.01};
    double fraction=0;
    Vec3 normal;
    assert(!swept_box(from,to,.01,target,target_box,fraction,normal));
    const double padding=arc_sagitta_padding(radius,angle);
    assert(padding>0&&padding<.05);
    assert(swept_box(from,to,.01+padding,target,target_box,fraction,normal));
}

void large_off_center_device_remains_in_authored_radius_broadphase() {
    Content content;
    content.assets["small_child"]={{"parts",Json::array({
        Json{{"id","root"},{"parent",nullptr},{"translation",{0,0,0}},
             {"boxes",Json::array({Json{{"center",{0,0,0}},{"size",{2,2,2}}}})}}
    })}};
    content.assets["oversized_device"]={{"parts",Json::array({
        Json{{"id","root"},{"parent",nullptr},{"translation",{0,0,0}},
             {"boxes",Json::array({Json{{"center",{0,0,0}},{"size",{2,2,2}}}})}},
        Json{{"id","east_wing"},{"parent","root"},{"translation",{105,0,0}},
             {"boxes",Json::array({Json{{"center",{0,1,0}},{"size",{2,4,2}}}})}}
    })},{"instances",Json::array({Json{{"id","child"},{"assetId","small_child"},{"translation",{-150,0,0}},{"scale",{2,1,1}}}})}};
    const double radius=authored_asset_radius(content,"oversized_device");
    const Vec3 from{105,1,5},to{105,1,-5};
    // This mirrors the old device broadphase failure: the exposed wall is more than 100 m from
    // the authored root, so the old hard-coded 4 m sphere skipped it before box testing.
    assert(segment_distance_squared({0,0,0},from,to)>16);
    assert(segment_overlaps_sphere({0,0,0},from,to,radius));
    assert(radius>153); // Includes the transformed nested instance on the opposite side.
    double fraction=0;Vec3 normal;
    assert(swept_box(from,to,0,{105,1,0},{2,4,2},fraction,normal));
    assert(!segment_overlaps_sphere({0,0,0},from,to,4));
}

} // namespace

int main() {
    hollow_asset_keeps_its_open_space();
    rotated_and_scaled_boxes_use_body_local_coordinates();
    point_volume_finds_adjacent_cells_on_first_surface();
    point_impact_cannot_damage_through_a_wall();
    swept_sphere_checks_rounded_box_corners();
    arc_sagitta_covers_targets_between_rotational_samples();
    large_off_center_device_remains_in_authored_radius_broadphase();
    std::cout << "native contact geometry tests passed\n";
}
