#include "actions.hpp"

#include <cassert>
#include <cmath>
#include <fstream>
#include <iostream>

using namespace feral;

namespace {

Json point_profile(int hit_frame = 3) {
    return {
        {"limits", {{"maxSweepSubdivisions", 8}, {"maxAngularStepDegrees", 12}}},
        {"profiles", {{"pick", {
            {"durationFrames", 8}, {"cooldownFrames", 8}, {"reach", 3.0},
            {"aimConeDegrees", 30}, {"damage", 8}, {"energyBudget", 20},
            {"damageShape", "point"},
            {"hitboxes", Json::array({{{"kind", "point"}, {"hitFrame", hit_frame},
                                      {"radius", 0.28}, {"maxContacts", 4}}})},
            {"visual", Json::array({
                {{"frame", 0}, {"position", Json::array({0, 0, 0})}, {"rotationDegrees", Json::array({0, 0, 0})}},
                {{"frame", 8}, {"position", Json::array({0, 0, -1})}, {"rotationDegrees", Json::array({0, 90, 0})}}
            })}
        }}}}
    };
}

ContactResult cell_contact(Cell cell, Vec3 point = {0, 0, -2}) {
    Contact contact;
    contact.hit = true;
    contact.kind = "cell";
    contact.cell = cell;
    contact.point = point;
    contact.distance = point.length();
    return {contact, false};
}

ContactResult target_contact(const std::string& id, Vec3 point = {0, 0, -2}, Cell wound_cell = {}) {
    Contact contact;
    contact.hit = true;
    contact.kind = "creature";
    contact.id = id;
    contact.part = "core";
    contact.cell = wound_cell;
    contact.point = point;
    contact.distance = point.length();
    return {contact, false};
}

std::vector<ContactResult> no_contacts(const HitQuery&) { return {}; }

void run_for(Actions& actions, double dt, int calls, const ActorPose& pose,
             const ContactResolver& resolve, const ContactSink& emit) {
    for (int i = 0; i < calls; ++i) actions.advance(dt, pose, resolve, emit);
}

Quat yaw_degrees(double degrees) {
    const double half = degrees * 3.14159265358979323846 / 360.0;
    return {0, std::sin(half), 0, std::cos(half)};
}

void fixed_timeline_ignores_render_cadence() {
    struct Result { int frame; double damage; double ray_length; };
    auto simulate = [](double render_dt, int calls, bool sample) {
        Actions actions;
        actions.configure(point_profile(3));
        const ActorPose pose{{0,0,0}, {}};
        assert(actions.begin({"pick", pose}));
        std::vector<Result> result;
        ContactResolver resolver = [](const HitQuery& query) {
            assert(query.kind == HitQueryKind::Point);
            assert(std::abs((query.to-query.from).length() - query.max_reach) < 1e-8);
            return std::vector<ContactResult>{cell_contact({1,2,3})};
        };
        ContactSink sink = [&result](const ContactEvent& event) {
            result.push_back({event.simulation_frame, event.damage, event.energy_remaining});
        };
        if (sample) {
            const VisualPose first = actions.sample_visual(0.5);
            const VisualPose repeated = actions.sample_visual(0.5);
            assert(first.active && first.timeline_frame == repeated.timeline_frame);
            assert(std::abs(first.local_position.z - repeated.local_position.z) < 1e-12);
            assert(std::abs(first.local_position.z + 0.0625) < 1e-9);
        }
        for (int i = 0; i < calls; ++i) {
            if (sample) {
                (void)actions.sample_visual(0.25);
                (void)actions.sample_visual(0.75);
            }
            actions.advance(render_dt, pose, resolver, sink);
        }
        return result;
    };
    const auto sixty = simulate(FIXED_DT, 8, true);
    const auto thirty = simulate(2*FIXED_DT, 4, false);
    const auto skipped = simulate(6*FIXED_DT, 2, true);
    assert(sixty.size() == 1 && thirty.size() == 1 && skipped.size() == 1);
    assert(sixty[0].frame == 3 && thirty[0].frame == 3 && skipped[0].frame == 3);
    assert(sixty[0].damage == thirty[0].damage && sixty[0].damage == skipped[0].damage);
}

void point_hit_boundary_volume_energy_and_dedup() {
    Actions actions;
    actions.configure(point_profile(3));
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"pick", pose}));
    std::vector<ContactEvent> events;
    int point_queries = 0;
    ContactResolver resolver = [&point_queries](const HitQuery& query) {
        ++point_queries;
        assert(query.simulation_frame == 3);
        assert(std::abs(query.radius - 0.28) < 1e-9);
        assert(query.max_contacts == 4);
        assert(query.from.length() == 0);
        return std::vector<ContactResult>{cell_contact({1,0,0}), cell_contact({2,0,0}),
                                          cell_contact({2,0,0}), cell_contact({3,0,0})};
    };
    ContactSink sink = [&events](const ContactEvent& event) { events.push_back(event); };
    run_for(actions, FIXED_DT, 2, pose, resolver, sink);
    assert(events.empty() && point_queries == 0);
    actions.advance(FIXED_DT, pose, resolver, sink);
    assert(point_queries == 1 && events.size() == 3);
    assert(events[0].simulation_frame == 3 && events[0].damage == 8);
    assert(events[1].damage == 8 && events[2].damage == 4);
    assert(events[2].energy_remaining == 0);
    run_for(actions, FIXED_DT, 5, pose, resolver, sink);
    assert(point_queries == 1 && events.size() == 3);
}

void query_filters_range_aim_and_occlusion() {
    Actions actions;
    actions.configure(point_profile(1));
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"pick", pose}));
    std::vector<ContactEvent> events;
    int call = 0;
    ContactResolver resolver = [&call](const HitQuery&) {
        ++call;
        if (call == 1) return std::vector<ContactResult>{cell_contact({1,0,0}, {0,0,-4})}; // out of reach
        if (call == 2) return std::vector<ContactResult>{cell_contact({1,0,0}, {2,0,0})}; // outside aim cone
        if (call == 3) { auto blocked = cell_contact({1,0,0}); blocked.occluded = true; return std::vector<ContactResult>{blocked}; }
        return std::vector<ContactResult>{cell_contact({1,0,0})};
    };
    ContactSink sink = [&events](const ContactEvent& event) { events.push_back(event); };
    actions.advance(FIXED_DT, pose, resolver, sink);
    assert(events.empty());
    // The test profile is a single configured point moment, so filtering one attempt does not turn
    // it into a later retry. Start separate swings for the remaining resolver outcomes.
    actions.advance(8*FIXED_DT, pose, no_contacts, sink);
    assert(!actions.active());
    assert(actions.begin({"pick", pose}));
    actions.advance(FIXED_DT, pose, resolver, sink);
    assert(events.empty());
    actions.advance(8*FIXED_DT, pose, no_contacts, sink);
    assert(actions.begin({"pick", pose}));
    actions.advance(FIXED_DT, pose, resolver, sink);
    assert(events.empty());
    actions.advance(8*FIXED_DT, pose, no_contacts, sink);
    assert(actions.begin({"pick", pose}));
    actions.advance(FIXED_DT, pose, resolver, sink);
    assert(events.size() == 1);
}

Json sweep_profile() {
    return {
        {"limits", {{"maxSweepSubdivisions", 8}, {"maxAngularStepDegrees", 12}}},
        {"profiles", {{"sword", {
            {"durationFrames", 8}, {"cooldownFrames", 8}, {"reach", 3.0},
            {"aimConeDegrees", 100}, {"damage", 10}, {"energyBudget", 15},
            {"damageShape", "slash"},
            {"hitboxes", Json::array({{{"kind", "sweep"}, {"activeStartFrame", 1},
                {"activeEndFrame", 5}, {"radius", 0.1}, {"maxContacts", 8},
                {"keyframes", Json::array({
                    {{"frame", 0}, {"position", Json::array({0,0,-2})}},
                    {{"frame", 8}, {"position", Json::array({0,0,-2})}}
                })}}})}
        }}}}
    };
}

void sweep_hits_multiple_targets_once_with_shared_energy() {
    Actions actions;
    actions.configure(sweep_profile());
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"sword", pose}));
    std::vector<ContactEvent> events;
    ContactResolver resolver = [](const HitQuery& query) {
        assert(query.kind == HitQueryKind::Sweep);
        return std::vector<ContactResult>{target_contact("wolf"), target_contact("boar")};
    };
    ContactSink sink = [&events](const ContactEvent& event) { events.push_back(event); };
    run_for(actions, FIXED_DT, 8, pose, resolver, sink);
    assert(events.size() == 2);
    assert(events[0].damage == 10 && events[1].damage == 5);
    assert(events[1].energy_remaining == 0);
}

void one_swing_can_wound_distinct_local_patches_but_not_repeat_one_patch() {
    Actions actions;
    actions.configure(sweep_profile());
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"sword", pose}));
    std::vector<ContactEvent> events;
    ContactResolver resolver = [](const HitQuery& query) {
        assert(query.kind == HitQueryKind::Sweep);
        return std::vector<ContactResult>{target_contact("wolf", {0,0,-2}, {1,0,0}),
            target_contact("wolf", {0,0,-2}, {1,0,0}),
            target_contact("wolf", {0,0,-2}, {2,0,0})};
    };
    const ContactSink sink = [&events](const ContactEvent& event) { events.push_back(event); };
    run_for(actions, FIXED_DT, 8, pose, resolver, sink);
    assert(events.size() == 2);
    assert(events[0].contact.cell.x == 1 && events[1].contact.cell.x == 2);
    assert(events[0].damage == 10 && events[1].damage == 5);
    assert(events[1].energy_remaining == 0);
}

void bounded_rotation_subdivision_covers_arc_without_large_fallback_volume() {
    Actions actions;
    actions.configure(sweep_profile());
    const ActorPose facing_north{{0,0,0}, {}};
    assert(actions.begin({"sword", facing_north}));
    int sweep_queries = 0;
    double largest_radius = 0;
    std::vector<ContactEvent> events;
    ContactResolver resolver = [&sweep_queries, &largest_radius](const HitQuery& query) {
        ++sweep_queries;
        largest_radius = std::max(largest_radius, query.radius);
        const Vec3 target{-2,0,0};
        const Vec3 delta = query.to-query.from;
        const double denominator = delta.length_squared();
        const double t = denominator > 1e-12 ? std::clamp((target-query.from).dot(delta)/denominator,0.0,1.0) : 0.0;
        if ((target-(query.from+delta*t)).length() <= query.radius + 0.02)
            return std::vector<ContactResult>{target_contact("arc-target", target)};
        return std::vector<ContactResult>{};
    };
    const ContactSink sink = [&events](const ContactEvent& event) { events.push_back(event); };
    actions.advance(FIXED_DT, facing_north, resolver, sink);
    actions.advance(FIXED_DT, ActorPose{{0,0,0}, yaw_degrees(180)}, resolver, sink);
    assert(sweep_queries == 8);
    assert(largest_radius > 0.1 && largest_radius < 0.2);
    assert(events.size() == 1); // target on the unsampled arc was still inside one swept capsule
}

void cancellation_reset_and_no_target_do_not_leave_stale_hits() {
    Actions actions;
    actions.configure(point_profile(4));
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"pick", pose}));
    int queries = 0;
    ContactResolver resolver = [&queries](const HitQuery&) {
        ++queries;
        return std::vector<ContactResult>{};
    };
    const ContactSink sink = [](const ContactEvent&) {};
    run_for(actions, FIXED_DT, 2, pose, resolver, sink);
    actions.cancel();
    run_for(actions, FIXED_DT, 8, pose, resolver, sink);
    assert(queries == 0 && !actions.active());

    assert(actions.begin({"pick", pose}));
    run_for(actions, FIXED_DT, 8, pose, resolver, sink);
    assert(queries == 1 && !actions.active());
    assert(actions.begin({"pick", pose}));
    actions.cancel();

    actions.reset();
    assert(actions.simulation_frame() == 0 && !actions.active());
    assert(actions.begin({"pick", pose}));
    assert(actions.current_attack_id() == 1);
    run_for(actions, FIXED_DT, 8, pose, resolver, sink);
    assert(queries == 2 && !actions.active());
}

void shipped_profiles_drive_point_and_moving_sweep_queries() {
    std::ifstream profile_file("native/data/action_profiles.json");
    if (!profile_file) {
        profile_file.clear();
        profile_file.open("../data/action_profiles.json");
    }
    assert(profile_file.good());
    Json profiles;
    profile_file >> profiles;
    Actions actions;
    actions.configure(profiles);
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"pick", pose}));
    int point_queries = 0;
    std::vector<ContactEvent> events;
    ContactResolver point_resolver = [&point_queries](const HitQuery& query) {
        ++point_queries;
        assert(query.kind == HitQueryKind::Point && query.simulation_frame == 6);
        assert(std::abs(query.max_reach - 6.5) < 1e-9);
        assert(std::abs(query.radius - 0.28) < 1e-9);
        return std::vector<ContactResult>{cell_contact({4,1,2}),cell_contact({4,1,3}),
                                          cell_contact({4,2,2}),cell_contact({4,2,3})};
    };
    ContactSink sink = [&events](const ContactEvent& event) { events.push_back(event); };
    run_for(actions, FIXED_DT, 6, pose, point_resolver, sink);
    assert(point_queries == 1 && events.size() == 4 && events[0].damage == 20 &&
           events[3].damage == 20 && events[3].energy_remaining == 0);
    run_for(actions, FIXED_DT, 5, pose, no_contacts, sink);
    assert(!actions.active());
    assert(actions.begin({"sword", pose}));

    int sweep_queries = 0;
    bool moving_center = false;
    ContactResolver sweep_resolver = [&sweep_queries, &moving_center](const HitQuery& query) {
        assert(query.kind == HitQueryKind::Sweep && query.profile_id == "sword");
        ++sweep_queries;
        moving_center = moving_center || (query.to-query.from).length() > 1e-4;
        return std::vector<ContactResult>{};
    };
    run_for(actions, FIXED_DT, 19, pose, sweep_resolver, sink);
    assert(sweep_queries > 0 && moving_center);
}

void invalid_editor_profiles_do_not_replace_running_actions() {
    Actions actions;
    actions.configure(point_profile(3));
    const ActorPose pose{{0,0,0}, {}};
    assert(actions.begin({"pick", pose}));
    Json invalid_interval=sweep_profile();
    invalid_interval["profiles"]["sword"]["hitboxes"][0]["activeEndFrame"]=0;
    bool rejected_interval=false;
    try { actions.configure(invalid_interval); }
    catch (const std::invalid_argument&) { rejected_interval=true; }
    assert(rejected_interval&&actions.active());

    Json invalid_radius=point_profile(3);
    invalid_radius["profiles"]["pick"]["hitboxes"][0]["radius"]=0;
    bool rejected_radius=false;
    try { actions.configure(invalid_radius); }
    catch (const std::invalid_argument&) { rejected_radius=true; }
    assert(rejected_radius&&actions.active());

    std::vector<ContactEvent> events;
    const ContactResolver resolver=[](const HitQuery&) { return std::vector<ContactResult>{cell_contact({7,1,2})}; };
    const ContactSink sink=[&events](const ContactEvent& event) { events.push_back(event); };
    run_for(actions,FIXED_DT,3,pose,resolver,sink);
    assert(events.size()==1&&events.front().simulation_frame==3&&events.front().profile_id=="pick");
}

} // namespace

int main() {
    fixed_timeline_ignores_render_cadence();
    point_hit_boundary_volume_energy_and_dedup();
    query_filters_range_aim_and_occlusion();
    sweep_hits_multiple_targets_once_with_shared_energy();
    one_swing_can_wound_distinct_local_patches_but_not_repeat_one_patch();
    bounded_rotation_subdivision_covers_arc_without_large_fallback_volume();
    cancellation_reset_and_no_target_do_not_leave_stale_hits();
    shipped_profiles_drive_point_and_moving_sweep_queries();
    invalid_editor_profiles_do_not_replace_running_actions();
    std::cout << "native actions tests passed\n";
}
