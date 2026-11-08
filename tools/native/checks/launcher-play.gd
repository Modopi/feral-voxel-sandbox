# Test driver only. The production scene, GUI, input dispatch and physics are unchanged.
# Run with an isolated XDG_DATA_HOME; the second invocation reopens its actual saved world.
extends SceneTree

class MigrationBridge extends Node:
    signal completed(path: String, error: String)
    var requests := 0
    func start_import(): requests += 1

var game: Node
var bridge: MigrationBridge
var evidence: Array = []
var failed := false
var touch_positions := {}
var reopen := false

func _initialize():
    call_deferred("run")

func require(ok: bool, message: String):
    if not ok:
        failed = true
        push_error("LAUNCHER_PLAY: " + message)
        finish(1)
        # Stop the coroutine immediately; quit alone waits until the end of this frame.
        assert(ok, message)

func frames(count := 4):
    for i in range(count): await process_frame

func ticks(count := 6):
    for i in range(count): await physics_frame
    await process_frame

func state() -> Dictionary:
    return JSON.parse_string(game.interaction_state())

func button(label: String, node: Node = root) -> Button:
    if node is Button and node.is_visible_in_tree() and node.text == label: return node
    for child in node.get_children():
        var found := button(label, child)
        if found: return found
    return null

func nodes_of_type(type: String, node: Node = root) -> Array:
    var result := []
    if node.is_class(type): result.append(node)
    for child in node.get_children(): result.append_array(nodes_of_type(type, child))
    return result

func has_text(text: String) -> bool:
    for label in nodes_of_type("Label"):
        if label.is_visible_in_tree() and text in label.text: return true
    return false

func screen_pos(pos: Vector2) -> Vector2:
    return root.get_final_transform() * pos

func touch(index: int, down: bool, pos: Vector2, cancelled := false):
    var event := InputEventScreenTouch.new()
    event.index = index
    event.pressed = down
    event.canceled = cancelled
    event.position = screen_pos(pos)
    if down: touch_positions[index] = pos
    else: touch_positions.erase(index)
    Input.parse_input_event(event)
    await frames(2)

func drag(index: int, pos: Vector2):
    var event := InputEventScreenDrag.new()
    event.index = index
    event.position = screen_pos(pos)
    event.relative = screen_pos(pos) - screen_pos(touch_positions[index])
    touch_positions[index] = pos
    Input.parse_input_event(event)
    await frames(2)

func tap(label: String, index := 0):
    var control := button(label)
    require(control != null, "missing GUI button: " + label)
    var rect := control.get_global_rect()
    require(root.get_visible_rect().encloses(rect), "button outside viewport: " + label + " rect=" + str(rect) + " viewport=" + str(root.get_visible_rect()))
    var pos := rect.get_center()
    await touch(index, true, pos)
    await touch(index, false, pos)
    await frames()

func key(code: Key, down: bool, unicode_value := 0):
    var event := InputEventKey.new()
    event.physical_keycode = code
    event.keycode = code
    event.unicode = unicode_value
    event.pressed = down
    Input.parse_input_event(event)
    await frames(2)

func press(code: Key):
    await key(code, true)
    await key(code, false)

func snapshot(name: String):
    var row := state()
    row["step"] = name
    evidence.append(row)
    print("LAUNCHER_PLAY ", name, " ", JSON.stringify(row))
    if DisplayServer.get_name() != "headless":
        await RenderingServer.frame_post_draw
        root.get_texture().get_image().save_png("user://launcher-" + name + ".png")

func show_start_button():
    # Exercise actual touch scrolling, including crossing check buttons.
    for attempt in range(5):
        var target := button("탐험 시작")
        if target.get_parent().get_parent().get_global_rect().encloses(target.get_global_rect()): return
        await touch(0, true, Vector2(1160, 720))
        for y in range(680, 300, -40): await drag(0, Vector2(1160, y))
        await touch(0, false, Vector2(1160, 320))
        await frames(10)
    require(false, "touch scroll cannot reach create-world button")

func start_new_world():
    await tap("새로운 세계")
    require(state().panel == "create", "new-world button must open form")
    await snapshot("create")
    # Choose the real launcher starting-kit option, so gameplay exercises a held pickaxe.
    await tap("시작 소지품")
    require(button("시작 소지품").button_pressed, "starting kit option must remain enabled")
    await show_start_button()
    await tap("탐험 시작")
    await ticks(90)
    require(state().playing and state().panel == "", "launcher create must enter actual gameplay")
    Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
    require(has_text("돌 곡괭이"), "launcher starting kit must equip the actual pickaxe")
    await snapshot("playing")

func leave_world():
    await tap("메뉴")
    require(state().paused, "menu pauses gameplay")
    await tap("저장하고 세계 나가기")
    require(not state().playing and state().panel == "launcher", "leave returns to launcher")
    require(not paused, "launcher scene tree cannot remain paused")
    await snapshot("saved-launcher")

func run():
    # Never touch a developer's normal user:// world directory.
    require("launcher-check" in OS.get_environment("XDG_DATA_HOME"), "isolated launcher-check XDG directory required")
    # Godot ScrollContainer enables touch dragging only on touch-capable displays.
    # This desktop test hint exercises that same path; injected raw touch events remain real events.
    Input.emulate_touch_from_mouse = true
    reopen = "--reopen" in OS.get_cmdline_user_args()
    root.size = Vector2i(844, 390) if "--phone" in OS.get_cmdline_user_args() else Vector2i(1280, 720)
    root.content_scale_size = Vector2i(1600, 900)
    bridge = MigrationBridge.new()
    root.add_child(bridge)
    Engine.register_singleton("FeralMigration", bridge)
    game = load("res://main.tscn").instantiate()
    root.add_child(game)
    await frames(8)
    require(state().panel == "launcher" and not state().playing, "normal boot must start at launcher")
    if not reopen:
        require(bridge.requests == 1, "fresh launch must request migration")
        await tap("새로운 세계")
        require(state().panel == "launcher" and has_text("기존 저장을 확인"), "pending import remains visible without silently swallowing start")
        bridge.completed.emit("", "")
        await frames()
        require(has_text("가져오지 못했습니다"), "empty bridge success fails visibly and preserves retry")
        await tap("저장 가져오기 다시 시도")
        require(bridge.requests == 2, "retry invokes migration bridge")
        var path := "user://launcher-empty-legacy.json"
        var file := FileAccess.open(path, FileAccess.WRITE)
        file.store_string('{"localStorage":{},"vault":{"available":false,"rows":[]}}')
        file.close()
        bridge.completed.emit(path, "")
        await frames(6)
        require(button("기본 탐험 맵") == null and button("개척 원정") == null and button("기계 베타 맵") == null, "empty install must not invent legacy worlds")
        await snapshot("migration-ready")
        await start_new_world()
        await check_gameplay()
        await leave_world()
        await tap("나의 세계")
        await ticks(12)
        require(state().playing, "continue button must reopen saved world in same process")
        await snapshot("continued")
        await leave_world()
    else:
        require(bridge.requests == 0, "successful import cannot block every subsequent boot")
        await tap("나의 세계")
        await ticks(30)
        require(state().playing and state().panel == "", "cold launch continue must reach gameplay")
        var previous: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://launcher-play.json"))
        var saved: Dictionary = previous.steps[-1]
        require(state().worldId == saved.worldId, "cold continue must reopen the same saved world")
        require(Vector2(state().position[0] - saved.position[0], state().position[2] - saved.position[2]).length() < 0.1, "cold continue preserves actual played position")
        Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
        await snapshot("cold-continued")
        await leave_world()
    finish(0)

func check_gameplay():
    var before := state()
    var move_origin := Vector2(200, 540)
    var look_origin := Vector2(1200, 430)
    await touch(0, true, move_origin)
    await drag(0, move_origin + Vector2(0, -100))
    await ticks(24)
    var walking := state()
    require(Vector2(walking.position[0] - before.position[0], walking.position[2] - before.position[2]).length() > 0.3, "touch stick must physically move the CharacterBody")
    require(not walking.attackHeld and walking.attackCount == before.attackCount, "movement touch must not become a mouse attack")
    await touch(1, true, look_origin)
    await drag(1, look_origin + Vector2(60, 20))
    var looking := state()
    require(abs(looking.yaw - walking.yaw) > 0.05, "second finger must rotate camera while moving")
    # A second finger in the movement zone cannot steal the original pointer.
    await touch(4, true, move_origin + Vector2(40, 0))
    await drag(4, move_origin + Vector2(140, 0))
    require(abs(state().move[0]) < 0.1 and state().move[1] < -0.5, "extra movement touch must not replace the owner")
    await touch(4, false, move_origin + Vector2(140, 0))
    var attack_pos := button("타격").get_global_rect().get_center()
    await touch(2, true, attack_pos)
    await ticks(40)
    require(state().attackHeld and state().attackCount == before.attackCount + 1, "third finger holds attack exactly once while move and look are held")
    require(state().actionSequence > before.actionSequence, "held HUD attack must start actual physical action timeline")
    await snapshot("three-finger-play")
    await touch(2, false, Vector2(1520, 100), true)
    require(not state().attackHeld, "cancel attack outside button must release held action")
    # Releases happen before GUI filtering, even when they end over another HUD button.
    await touch(0, false, button("메뉴").get_global_rect().get_center())
    await touch(1, false, button("가방").get_global_rect().get_center(), true)
    await ticks(2)
    require(Vector2(state().move[0], state().move[1]).is_zero_approx() and state().pointerCount == 0, "release/cancel over GUI cannot leave movement or look stuck: " + JSON.stringify(state()))
    # Aim at nearby ground and prove input reaches physical contact, not only an animation.
    await touch(1, true, look_origin)
    await drag(1, look_origin + Vector2(0, 350))
    await touch(1, false, look_origin + Vector2(0, 350))
    var hits_before: int = state().hitCount
    await touch(2, true, attack_pos)
    await ticks(60)
    await touch(2, false, attack_pos)
    require(state().hitCount > hits_before and state().panel == "" and not state().paused, "aimed tool input must successfully damage terrain without a runtime exception")
    await snapshot("physical-hit")
    await ticks(90)
    var jump_before: float = state().position[1]
    await tap("점프", 3)
    await ticks(8)
    require(state().position[1] > jump_before + 0.2, "jump button must produce vertical physical movement")
    await snapshot("jumped")
    await ticks(90)
    # Keyboard uses the same gameplay movement path, not a separate game session.
    before = state()
    await key(KEY_D, true)
    await ticks(24)
    await key(KEY_D, false)
    var after := state()
    require(Vector2(after.position[0] - before.position[0], after.position[2] - before.position[2]).length() > 0.3, "desktop keyboard movement remains functional")
    # Menu entry while movement is held clears all owners, and panels cannot attack.
    await touch(0, true, move_origin)
    await drag(0, move_origin + Vector2(0, -100))
    await tap("메뉴", 2)
    require(state().paused and state().pointerCount == 0 and Vector2(state().move[0], state().move[1]).is_zero_approx() and not state().attackHeld, "menu tap as another pointer clears gameplay input")
    await touch(0, false, move_origin)
    await tap("탐험 계속")
    Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
    await touch(0, true, move_origin)
    await drag(0, move_origin + Vector2(0, -100))
    await touch(2, true, button("타격").get_global_rect().get_center())
    game.notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
    await frames()
    require(state().pointerCount == 0 and Vector2(state().move[0], state().move[1]).is_zero_approx() and not state().attackHeld, "focus loss clears all input")
    await touch(0, false, move_origin)
    await touch(2, false, Vector2(1300, 430), true)
    game.notification(Node.NOTIFICATION_APPLICATION_FOCUS_IN)
    if state().panel != "": await tap("탐험 계속")
    Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
    await snapshot("input-released")

func finish(code: int):
    if failed: code = 1
    var path := "user://launcher-play-reopen.json" if reopen else "user://launcher-play.json"
    var file := FileAccess.open(path, FileAccess.WRITE)
    if file:
        file.store_string(JSON.stringify({"passed": code == 0, "renderer": DisplayServer.get_name(), "windowSize": [root.size.x, root.size.y], "scope": "Normal C++ scene boot, real GUI/Input events and Jolt; migration bridge simulated, Android exporter checked separately; not a physical phone", "steps": evidence}, "  "))
        file.close()
    if Engine.has_singleton("FeralMigration"): Engine.unregister_singleton("FeralMigration")
    quit(code)
