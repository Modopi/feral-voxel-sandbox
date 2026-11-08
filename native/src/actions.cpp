#include "actions.hpp"
#include "contact_geometry.hpp"

#include <limits>
#include <stdexcept>

namespace feral {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTimeEpsilon = 1e-10;

Vec3 vector_value(const Json& value, const Vec3& fallback = {}) {
    if (value.is_array() && value.size() >= 3) {
        return {value[0].get<double>(), value[1].get<double>(), value[2].get<double>()};
    }
    if (value.is_object()) {
        return {value.value("x", fallback.x), value.value("y", fallback.y), value.value("z", fallback.z)};
    }
    return fallback;
}

Quat normalized(Quat q) {
    const double n = std::sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w);
    if (n <= 1e-12) return {};
    return {q.x/n, q.y/n, q.z/n, q.w/n};
}

Quat multiply(Quat a, Quat b) {
    return {
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    };
}

Quat euler_degrees(Vec3 degrees) {
    const double hx = degrees.x * kPi / 360.0;
    const double hy = degrees.y * kPi / 360.0;
    const double hz = degrees.z * kPi / 360.0;
    const Quat qx{std::sin(hx), 0, 0, std::cos(hx)};
    const Quat qy{0, std::sin(hy), 0, std::cos(hy)};
    const Quat qz{0, 0, std::sin(hz), std::cos(hz)};
    return normalized(multiply(qz, multiply(qy, qx)));
}

double quat_dot(Quat a, Quat b) {
    return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
}

Quat slerp(Quat a, Quat b, double t) {
    a = normalized(a);
    b = normalized(b);
    double dot = quat_dot(a, b);
    if (dot < 0) {
        b = {-b.x, -b.y, -b.z, -b.w};
        dot = -dot;
    }
    dot = std::clamp(dot, -1.0, 1.0);
    if (dot > 0.9995) {
        return normalized({a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t,
                           a.z + (b.z-a.z)*t, a.w + (b.w-a.w)*t});
    }
    const double angle = std::acos(dot);
    const double sine = std::sin(angle);
    const double wa = std::sin((1-t)*angle) / sine;
    const double wb = std::sin(t*angle) / sine;
    return normalized({a.x*wa+b.x*wb, a.y*wa+b.y*wb,
                       a.z*wa+b.z*wb, a.w*wa+b.w*wb});
}

double rotation_angle(Quat a, Quat b) {
    const double d = std::clamp(std::abs(quat_dot(normalized(a), normalized(b))), 0.0, 1.0);
    return 2.0 * std::acos(d);
}

ActorPose interpolate_actor(const ActorPose& a, const ActorPose& b, double t) {
    return {a.origin + (b.origin-a.origin)*t, slerp(a.rotation, b.rotation, t)};
}

double read_finite(const Json& value, const char* key, double fallback) {
    const double result = value.value(key, fallback);
    if (!std::isfinite(result)) throw std::invalid_argument(std::string("non-finite action profile field: ") + key);
    return result;
}

int read_int(const Json& value, const char* key, int fallback) {
    if (!value.contains(key)) return fallback;
    if (!value[key].is_number_integer()) throw std::invalid_argument(std::string("invalid action profile integer: ") + key);
    return value[key].get<int>();
}

} // namespace

void Actions::configure(const Json& data) {
    if (!data.is_object() || !data.contains("profiles"))
        throw std::invalid_argument("action profiles require a profiles object");
    if (data.contains("fixedHz") && data["fixedHz"].get<int>() != 60)
        throw std::invalid_argument("action timeline fixedHz must be 60");

    int new_max_sweep_subdivisions = 8;
    double new_max_angular_step_degrees = 12.0;
    if (data.contains("limits")) {
        const Json& limits = data["limits"];
        new_max_sweep_subdivisions = read_int(limits, "maxSweepSubdivisions", 8);
        new_max_angular_step_degrees = read_finite(limits, "maxAngularStepDegrees", 12.0);
        if (new_max_sweep_subdivisions < 1 || new_max_sweep_subdivisions > 32 ||
            new_max_angular_step_degrees <= 0 || new_max_angular_step_degrees > 90)
            throw std::invalid_argument("invalid action sweep subdivision limits");
    }

    const Json& rows = data["profiles"];
    std::map<std::string, Profile> new_profiles;
    auto parse_profile = [&new_profiles](const std::string& id, const Json& row) {
        if (!row.is_object()) throw std::invalid_argument("action profile must be an object: " + id);
        Profile profile;
        profile.id = row.value("id", id);
        if (profile.id != id) throw std::invalid_argument("action profile key/id mismatch: " + id);
        profile.duration_frames = read_int(row, "durationFrames", 1);
        profile.cooldown_frames = read_int(row, "cooldownFrames", profile.duration_frames);
        profile.reach = read_finite(row, "reach", 1.0);
        profile.aim_cone_degrees = read_finite(row, "aimConeDegrees", 180.0);
        profile.damage = read_finite(row, "damage", 1.0);
        profile.mining_reference_damage = read_finite(row, "miningReferenceDamage", profile.damage);
        profile.energy_budget = read_finite(row, "energyBudget", profile.damage);
        profile.damage_shape = row.value("damageShape", std::string("point"));
        if (profile.duration_frames < 1 || profile.cooldown_frames < 1 || profile.reach <= 0 ||
            profile.aim_cone_degrees < 0 || profile.aim_cone_degrees > 180 || profile.damage < 0 ||
            profile.energy_budget < 0 || profile.mining_reference_damage <= 0 || profile.damage_shape.empty())
            throw std::invalid_argument("invalid action profile values: " + id);

        if (row.contains("hitboxes")) {
            if (!row["hitboxes"].is_array()) throw std::invalid_argument("hitboxes must be an array: " + id);
            for (const Json& source : row["hitboxes"]) {
                if (!source.is_object()) throw std::invalid_argument("hitbox must be an object: " + id);
                HitboxProfile hitbox;
                const std::string kind = source.value("kind", std::string("point"));
                if (kind == "point") {
                    hitbox.kind = HitQueryKind::Point;
                    hitbox.hit_frame = read_int(source, "hitFrame", 1);
                    hitbox.active_start = hitbox.active_end = hitbox.hit_frame;
                    hitbox.max_contacts = read_int(source, "maxContacts", 4);
                } else if (kind == "sweep") {
                    hitbox.kind = HitQueryKind::Sweep;
                    hitbox.active_start = read_int(source, "activeStartFrame", 1);
                    hitbox.active_end = read_int(source, "activeEndFrame", hitbox.active_start);
                    hitbox.max_contacts = read_int(source, "maxContacts", 8);
                    if (!source.contains("keyframes") || !source["keyframes"].is_array() || source["keyframes"].empty())
                        throw std::invalid_argument("sweep hitbox requires keyframes: " + id);
                    for (const Json& key : source["keyframes"]) {
                        if (!key.is_object()) throw std::invalid_argument("sweep keyframe must be an object: " + id);
                        const int frame = read_int(key, "frame", 0);
                        hitbox.keys.push_back({static_cast<double>(frame), vector_value(key.value("position", Json::array({0, 0, -1})))});
                    }
                    std::sort(hitbox.keys.begin(), hitbox.keys.end(), [](const HitKeyframe& a, const HitKeyframe& b) {
                        return a.frame < b.frame;
                    });
                    for (size_t i = 1; i < hitbox.keys.size(); ++i)
                        if (hitbox.keys[i-1].frame == hitbox.keys[i].frame)
                            throw std::invalid_argument("duplicate sweep keyframe frame: " + id);
                    for (const HitKeyframe& key : hitbox.keys)
                        if (key.frame < 0 || key.frame > profile.duration_frames)
                            throw std::invalid_argument("sweep keyframe is outside action duration: " + id);
                } else {
                    throw std::invalid_argument("unsupported hitbox kind: " + kind);
                }
                hitbox.radius = read_finite(source, "radius", 0.1);
                if (hitbox.radius <= 0 || hitbox.max_contacts < 1 || hitbox.max_contacts > 64 ||
                    hitbox.active_start < 1 || hitbox.active_end < hitbox.active_start ||
                    hitbox.active_end > profile.duration_frames ||
                    (hitbox.kind == HitQueryKind::Point && hitbox.hit_frame > profile.duration_frames))
                    throw std::invalid_argument("invalid hitbox timing/radius: " + id);
                profile.hitboxes.push_back(std::move(hitbox));
            }
        }

        if (row.contains("visual")) {
            if (!row["visual"].is_array()) throw std::invalid_argument("visual track must be an array: " + id);
            for (const Json& key : row["visual"]) {
                if (!key.is_object()) throw std::invalid_argument("visual keyframe must be an object: " + id);
                VisualKeyframe parsed;
                parsed.frame = read_finite(key, "frame", 0);
                parsed.position = vector_value(key.value("position", Json::array({0, 0, 0})));
                parsed.rotation = euler_degrees(vector_value(key.value("rotationDegrees", Json::array({0, 0, 0}))));
                profile.visual.push_back(parsed);
            }
            std::sort(profile.visual.begin(), profile.visual.end(), [](const VisualKeyframe& a, const VisualKeyframe& b) {
                return a.frame < b.frame;
            });
            for (size_t i = 1; i < profile.visual.size(); ++i)
                if (profile.visual[i-1].frame == profile.visual[i].frame)
                    throw std::invalid_argument("duplicate visual keyframe frame: " + id);
            for (const VisualKeyframe& key : profile.visual)
                if (key.frame < 0 || key.frame > profile.duration_frames)
                    throw std::invalid_argument("visual keyframe is outside action duration: " + id);
        }
        if (!new_profiles.emplace(id, std::move(profile)).second)
            throw std::invalid_argument("duplicate action profile id: " + id);
    };

    if (rows.is_object()) {
        for (auto it = rows.begin(); it != rows.end(); ++it) parse_profile(it.key(), it.value());
    } else if (rows.is_array()) {
        for (const Json& row : rows) {
            if (!row.is_object() || !row.contains("id")) throw std::invalid_argument("array action profile needs id");
            parse_profile(row["id"].get<std::string>(), row);
        }
    } else {
        throw std::invalid_argument("profiles must be an object or array");
    }
    if (new_profiles.empty()) throw std::invalid_argument("action profiles must contain at least one profile");

    // Keep the current profiles and running action intact if any editor value failed validation.
    reset();
    profiles_.swap(new_profiles);
    max_sweep_subdivisions_ = new_max_sweep_subdivisions;
    max_angular_step_degrees_ = new_max_angular_step_degrees;
}

bool Actions::begin(const ActionIntent& intent) {
    const auto found = profiles_.find(intent.profile_id);
    if (found == profiles_.end() || active_ || simulation_frame_ < next_start_frame_) return false;
    current_profile_ = &found->second;
    active_ = true;
    started_frame_ = simulation_frame_;
    next_start_frame_ = started_frame_ + std::max(current_profile_->duration_frames, current_profile_->cooldown_frames);
    remaining_energy_ = current_profile_->energy_budget;
    attack_id_ = next_attack_id_++;
    contacted_.clear();
    previous_actor_pose_ = {intent.actor.origin, normalized(intent.actor.rotation)};
    last_sample_actor_pose_ = previous_actor_pose_;
    have_actor_pose_ = true;
    have_fixed_actor_pose_ = true;
    return true;
}

void Actions::cancel() {
    active_ = false;
    current_profile_ = nullptr;
    remaining_energy_ = 0;
    contacted_.clear();
}

void Actions::reset() {
    active_ = false;
    current_profile_ = nullptr;
    have_actor_pose_ = false;
    have_fixed_actor_pose_ = false;
    simulation_frame_ = 0;
    started_frame_ = 0;
    next_start_frame_ = 0;
    accumulator_ = 0;
    remaining_energy_ = 0;
    attack_id_ = 0;
    next_attack_id_ = 1;
    contacted_.clear();
}

void Actions::advance(double dt, const ActorPose& actor, const ContactResolver& resolve,
                      const ContactSink& emit) {
    if (!std::isfinite(dt) || dt < 0) throw std::invalid_argument("action timeline dt must be finite and nonnegative");
    const ActorPose old_pose = have_actor_pose_ ? last_sample_actor_pose_ : ActorPose{actor.origin, normalized(actor.rotation)};
    const double old_accumulator = accumulator_;
    const double interval = dt;
    accumulator_ += dt;
    const int steps = static_cast<int>(std::floor((accumulator_ + kTimeEpsilon) / FIXED_DT));
    for (int i = 0; i < steps; ++i) {
        const double offset = FIXED_DT * (i + 1) - old_accumulator;
        const double fraction = interval > 0 ? std::clamp(offset / interval, 0.0, 1.0) : 1.0;
        const ActorPose step_actor = interpolate_actor(old_pose, {actor.origin, normalized(actor.rotation)}, fraction);
        if (!have_fixed_actor_pose_) {
            previous_actor_pose_ = old_pose;
            have_fixed_actor_pose_ = true;
        }
        ++simulation_frame_;
        fixed_step(step_actor, resolve, emit);
        previous_actor_pose_ = step_actor;
    }
    accumulator_ -= static_cast<double>(steps) * FIXED_DT;
    if (accumulator_ < 0 && accumulator_ > -kTimeEpsilon) accumulator_ = 0;
    last_sample_actor_pose_ = {actor.origin, normalized(actor.rotation)};
    have_actor_pose_ = true;
}

void Actions::fixed_step(const ActorPose& actor, const ContactResolver& resolve, const ContactSink& emit) {
    if (!active_ || !current_profile_) return;
    const Profile& profile = *current_profile_;
    const int age = simulation_frame_ - started_frame_;
    const double aim_angle = profile.aim_cone_degrees * kPi / 180.0;
    const double minimum_aim_dot = std::cos(aim_angle);
    const Vec3 aim_direction = rotate(normalized(actor.rotation), {0, 0, -1}).normalized();

    if (resolve && remaining_energy_ > 1e-12) {
        for (const HitboxProfile& hitbox : profile.hitboxes) {
            if (remaining_energy_ <= 1e-12) break;
            if (hitbox.kind == HitQueryKind::Point) {
                if (age != hitbox.hit_frame) continue;
                HitQuery query;
                query.kind = HitQueryKind::Point;
                query.profile_id = profile.id;
                query.attack_id = attack_id_;
                query.simulation_frame = simulation_frame_;
                query.from = actor.origin;
                query.to = actor.origin + aim_direction * profile.reach;
                query.radius = hitbox.radius;
                query.actor_origin = actor.origin;
                query.aim_direction = aim_direction;
                query.max_reach = profile.reach;
                query.minimum_aim_dot = minimum_aim_dot;
                query.max_contacts = hitbox.max_contacts;
                query.damage_shape = profile.damage_shape;
                query_contact(query, resolve, emit);
                continue;
            }

            const double interval_start = std::max(static_cast<double>(age - 1), static_cast<double>(hitbox.active_start));
            const double interval_end = std::min(static_cast<double>(age), static_cast<double>(hitbox.active_end));
            if (interval_end <= interval_start + kTimeEpsilon) continue;
            const double within_tick_start = interval_start - (age - 1);
            const double within_tick_end = interval_end - (age - 1);
            const ActorPose segment_actor_start = interpolate_actor(previous_actor_pose_, actor, within_tick_start);
            const ActorPose segment_actor_end = interpolate_actor(previous_actor_pose_, actor, within_tick_end);
            const double turn = rotation_angle(segment_actor_start.rotation, segment_actor_end.rotation);
            const double max_step = max_angular_step_degrees_ * kPi / 180.0;
            const int desired = std::max(1, static_cast<int>(std::ceil(turn / max_step)));
            const int subdivisions = std::min(desired, max_sweep_subdivisions_);
            const double angle_per_subdivision = turn / subdivisions;
            for (int segment = 0; segment < subdivisions && remaining_energy_ > 1e-12; ++segment) {
                const double a = static_cast<double>(segment) / subdivisions;
                const double b = static_cast<double>(segment + 1) / subdivisions;
                const ActorPose pose_a = interpolate_actor(segment_actor_start, segment_actor_end, a);
                const ActorPose pose_b = interpolate_actor(segment_actor_start, segment_actor_end, b);
                const double frame_a = interval_start + (interval_end-interval_start)*a;
                const double frame_b = interval_start + (interval_end-interval_start)*b;
                const Vec3 local_a = hit_position(hitbox, frame_a);
                const Vec3 local_b = hit_position(hitbox, frame_b);
                const Vec3 world_a = pose_a.origin + rotate(pose_a.rotation, local_a);
                const Vec3 world_b = pose_b.origin + rotate(pose_b.rotation, local_b);
                const double lever = std::max(local_a.length(), local_b.length());
                // A swept sphere follows the chord between samples. Inflate it by the arc sagitta
                // so the unsampled rotational path remains covered even when the subdivision cap
                // is reached; this avoids a huge actor-sized query at high but bounded turns.
                const double sweep_padding = contact_geometry::arc_sagitta_padding(lever, angle_per_subdivision);
                HitQuery query;
                query.kind = HitQueryKind::Sweep;
                query.profile_id = profile.id;
                query.attack_id = attack_id_;
                query.simulation_frame = simulation_frame_;
                query.from = world_a;
                query.to = world_b;
                query.radius = hitbox.radius + sweep_padding;
                query.actor_origin = pose_a.origin;
                query.aim_direction = aim_direction;
                query.max_reach = profile.reach;
                query.minimum_aim_dot = minimum_aim_dot;
                query.max_contacts = hitbox.max_contacts;
                query.damage_shape = profile.damage_shape;
                query_contact(query, resolve, emit);
            }
        }
    }

    if (age >= profile.duration_frames) {
        active_ = false;
        current_profile_ = nullptr;
        remaining_energy_ = 0;
        contacted_.clear();
    }
}

void Actions::query_contact(const HitQuery& query, const ContactResolver& resolve, const ContactSink& emit) {
    if (!resolve) return;
    const std::vector<ContactResult> results = resolve(query);
    int accepted = 0;
    for (const ContactResult& result : results) {
        // A blocker prevents any farther candidate in this nearest-first result set.
        if (result.occluded) break;
        if (!result.contact.hit) continue;
        const Contact& contact = result.contact;
        const Vec3 to_contact = contact.point - query.actor_origin;
        const double distance = to_contact.length();
        if (distance > query.max_reach + query.radius + 1e-9) continue;
        if (distance > 1e-9 && to_contact.normalized().dot(query.aim_direction) + 1e-9 < query.minimum_aim_dot) continue;
        const std::string key = contact_key(contact);
        if (contacted_.find(key) != contacted_.end()) continue;
        if (remaining_energy_ <= 1e-12 || !current_profile_) break;
        contacted_.insert(key);
        const double damage = std::min(current_profile_->damage, remaining_energy_);
        remaining_energy_ = std::max(0.0, remaining_energy_ - damage);
        ++accepted;
        if (emit) {
            emit(ContactEvent{attack_id_, current_profile_->id, simulation_frame_, contact, damage,
                              current_profile_->mining_reference_damage, remaining_energy_,
                              current_profile_->damage_shape, query.kind});
        }
        // Point attacks issue one sphere query at one configured instant; its bounded contact count
        // lets a broad pick impact reach nearby cells without repeating damage on later frames.
        if (accepted >= query.max_contacts) break;
    }
}

std::string Actions::contact_key(const Contact& contact) const {
    if (contact.kind == "cell" || contact.kind == "voxel" || contact.kind == "block" || contact.id.empty())
        return "cell:" + cell_key(contact.cell);
    return "target:" + contact.kind + ":" + contact.id + ":" + contact.part + ":" + cell_key(contact.cell);
}

Vec3 Actions::hit_position(const HitboxProfile& hitbox, double frame) {
    if (hitbox.keys.empty()) return {};
    if (frame <= hitbox.keys.front().frame) return hitbox.keys.front().position;
    if (frame >= hitbox.keys.back().frame) return hitbox.keys.back().position;
    auto upper = std::upper_bound(hitbox.keys.begin(), hitbox.keys.end(), frame,
        [](double value, const HitKeyframe& key) { return value < key.frame; });
    const HitKeyframe& b = *upper;
    const HitKeyframe& a = *(upper - 1);
    const double t = (frame - a.frame) / (b.frame - a.frame);
    return a.position + (b.position - a.position) * t;
}

VisualPose Actions::interpolate_visual(const Profile& profile, double frame) {
    VisualPose pose;
    pose.active = true;
    pose.profile_id = profile.id;
    pose.timeline_frame = frame;
    if (profile.visual.empty()) return pose;
    if (frame <= profile.visual.front().frame) {
        pose.local_position = profile.visual.front().position;
        pose.local_rotation = profile.visual.front().rotation;
        return pose;
    }
    if (frame >= profile.visual.back().frame) {
        pose.local_position = profile.visual.back().position;
        pose.local_rotation = profile.visual.back().rotation;
        return pose;
    }
    auto upper = std::upper_bound(profile.visual.begin(), profile.visual.end(), frame,
        [](double value, const VisualKeyframe& key) { return value < key.frame; });
    const VisualKeyframe& b = *upper;
    const VisualKeyframe& a = *(upper - 1);
    const double t = (frame - a.frame) / (b.frame - a.frame);
    pose.local_position = a.position + (b.position - a.position) * t;
    pose.local_rotation = slerp(a.rotation, b.rotation, t);
    return pose;
}

VisualPose Actions::sample_visual(double interpolation) const {
    if (!active_ || !current_profile_) return {};
    const double alpha = std::clamp(interpolation, 0.0, 1.0);
    const double frame = std::clamp(static_cast<double>(simulation_frame_ - started_frame_) + alpha,
                                    0.0, static_cast<double>(current_profile_->duration_frames));
    return interpolate_visual(*current_profile_, frame);
}

} // namespace feral
