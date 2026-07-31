#!/usr/bin/env python3
"""Apply MkCleaner's patches to a fresh Mole source tree.

A bundled engine must not expose the surfaces that would rewrite or delete
itself, or touch the rest of the system:

- `uninstall`   — removes applications (the app has its own uninstall view)
- `installer`   — removes installer files system-wide
- `completion`  — writes shell configuration
- `update`      — rewrites the engine inside .app, breaking the signature
- `remove`      — deletes the engine inside .app, breaking the signature

The main menu drops uninstall (renumbering the remaining items) and the
update banner key becomes a no-op; the CLI dispatch refuses all five.
Everything else — clean, optimize, analyze, status, history, purge, touchid
— is untouched.

GPL-3.0: Mole is modified here; the modification list lives in
THIRD_PARTY.md and the patched tree ships with the app.
"""

import sys
from pathlib import Path


def apply(path: Path, pairs: list[tuple[str, str]]) -> None:
    text = path.read_text()
    for old, new in pairs:
        if old not in text:
            raise SystemExit(
                f"PATCH FAILED: anchor not found in {path}: {old[:70]!r}"
            )
        text = text.replace(old, new, 1)
    path.write_text(text)
    print(f"  patched {path}")


def main() -> None:
    root = Path(sys.argv[1])

    # --- shared command list (help text, completions) ----------------------
    commands = root / "lib" / "core" / "commands.sh"
    for entry in (
        '    "uninstall:Remove apps completely"\n',
        '    "installer:Find and remove installer files"\n',
        '    "completion:Setup shell tab completion"\n',
        '    "update:Update to latest version"\n',
        '    "remove:Remove Mole from system"\n',
    ):
        apply(commands, [(entry, "")])

    # --- overview help lines for the refused commands ----------------------
    update_sh = root / "lib" / "manage" / "update.sh"
    for line in (
        '    printf "  %s%-28s%s %s\\n" "$GREEN" "mo uninstall --dry-run" "$NC" "Preview app uninstall"\n',
        '    printf "  %s%-28s%s %s\\n" "$GREEN" "mo installer --dry-run" "$NC" "Preview installer cleanup"\n',
        '    printf "  %s%-28s%s %s\\n" "$GREEN" "mo completion --dry-run" "$NC" "Preview shell completion edits"\n',
        '    printf "  %s%-28s%s %s\\n" "$GREEN" "mo update --force" "$NC" "Force reinstall latest stable version"\n',
        '    printf "  %s%-28s%s %s\\n" "$GREEN" "mo update --nightly" "$NC" "Install latest unreleased main branch build"\n',
        '    printf "  %s%-28s%s %s\\n" "$GREEN" "mo remove --dry-run" "$NC" "Preview Mole removal"\n',
    ):
        apply(update_sh, [(line, "")])

    # --- status-go: thermal throttle state --------------------------------
    # The engine deliberately does not read the CPU temperature: on Apple
    # Silicon the SMC keys need root, which a GUI app never has, and the
    # storage sensor is a private HID event service only WindowServer can
    # open. What *is* readable without root is the CPU scheduler throttle
    # state (`pmset -g therm`): 100 means no throttling, lower means the CPU
    # is being held back because of heat — the one useful thermal signal a
    # userland app can get.
    metrics_go = root / "cmd" / "status" / "metrics.go"
    apply(metrics_go, [
        (
            '\tBatteryTemp  float64 `json:"battery_temp"` // Battery temperature in Celsius when exposed by AppleSmartBattery\n',
            '\tBatteryTemp  float64 `json:"battery_temp"` // Battery temperature in Celsius when exposed by AppleSmartBattery\n'
            '\tThermalLevel int     `json:"thermal_level"` // 100 = not throttled; lower = CPU throttling due to heat\n',
        ),
    ])

    battery_go = root / "cmd" / "status" / "metrics_battery.go"
    apply(battery_go, [
        (
            '\t// Do not synthesize CPU temperature from battery sensors or cpu_thermal_level.\n'
            '\t// Those values are not CPU-package temperatures and produce false overheating data.\n'
            '\treturn thermal\n'
            '}\n',
            '\t// Do not synthesize CPU temperature from battery sensors or cpu_thermal_level.\n'
            '\t// Those values are not CPU-package temperatures and produce false overheating data.\n'
            '\n'
            '\t// Thermal throttle state from pmset — no root needed.\n'
            '\tif out, err := runCmd(ctxPower, "pmset", "-g", "therm"); err == nil {\n'
            '\t\tthermal.ThermalLevel = parseThermalLevel(out)\n'
            '\t}\n'
            '\n'
            '\treturn thermal\n'
            '}\n',
        ),
        (
            'func parseAppleSmartBatteryThermal(out string) ThermalStatus {\n',
            'func parseThermalLevel(out string) int {\n'
            '\tfor line := range strings.Lines(out) {\n'
            '\t\tif strings.HasPrefix(strings.TrimSpace(line), "CPU_Scheduler_Limit") {\n'
            '\t\t\tif _, after, found := strings.Cut(line, "="); found {\n'
            '\t\t\t\tif v, err := strconv.Atoi(strings.TrimSpace(after)); err == nil {\n'
            '\t\t\t\t\treturn v\n'
            '\t\t\t\t}\n'
            '\t\t\t}\n'
            '\t\t}\n'
            '\t}\n'
            '\treturn 100\n'
            '}\n'
            '\n'
            'func parseAppleSmartBatteryThermal(out string) ThermalStatus {\n',
        ),
    ])

    # --- entrypoint --------------------------------------------------------
    mole = root / "mole"

    # Menu rows: drop Uninstall, renumber the rest.
    apply(mole, [
        (
            '    printf \'\\r\\033[2K%s\\n\' "$(show_menu_option 2 "Uninstall    Remove apps completely" "$([[ $selected -eq 2 ]] && echo true || echo false)")"\n',
            "",
        ),
        (
            'show_menu_option 3 "Optimize     Refresh caches and services" "$([[ $selected -eq 3 ]] && echo true || echo false)")"',
            'show_menu_option 2 "Optimize     Refresh caches and services" "$([[ $selected -eq 2 ]] && echo true || echo false)")"',
        ),
        (
            'show_menu_option 4 "Analyze      Explore disk usage" "$([[ $selected -eq 4 ]] && echo true || echo false)")"',
            'show_menu_option 3 "Analyze      Explore disk usage" "$([[ $selected -eq 3 ]] && echo true || echo false)")"',
        ),
        (
            'show_menu_option 5 "Status       Monitor system health" "$([[ $selected -eq 5 ]] && echo true || echo false)")"',
            'show_menu_option 4 "Status       Monitor system health" "$([[ $selected -eq 4 ]] && echo true || echo false)")"',
        ),
    ])

    # Menu navigation: four items now.
    apply(mole, [("((current_option < 5))", "((current_option < 4))")])

    # Enter key: drop Uninstall, renumber.
    apply(mole, [
        ('                    2) launch_menu_command "$SCRIPT_DIR/bin/uninstall.sh" ;;\n', ""),
        ('                    3) launch_menu_command "$SCRIPT_DIR/bin/optimize.sh" ;;',
         '                    2) launch_menu_command "$SCRIPT_DIR/bin/optimize.sh" ;;'),
        ('                    4) launch_menu_command "$SCRIPT_DIR/bin/analyze.sh" ;;',
         '                    3) launch_menu_command "$SCRIPT_DIR/bin/analyze.sh" ;;'),
        ('                    5) launch_menu_command "$SCRIPT_DIR/bin/status.sh" ;;',
         '                    4) launch_menu_command "$SCRIPT_DIR/bin/status.sh" ;;'),
    ])

    # Number keys: drop 2=uninstall, renumber.
    apply(mole, [
        ('''            "CHAR:2")
                launch_menu_command "$SCRIPT_DIR/bin/uninstall.sh"
                ;;
''', ""),
        ('''            "CHAR:3")
                launch_menu_command "$SCRIPT_DIR/bin/optimize.sh"
''', '''            "CHAR:2")
                launch_menu_command "$SCRIPT_DIR/bin/optimize.sh"
'''),
        ('''            "CHAR:4")
                launch_menu_command "$SCRIPT_DIR/bin/analyze.sh"
''', '''            "CHAR:3")
                launch_menu_command "$SCRIPT_DIR/bin/analyze.sh"
'''),
        ('''            "CHAR:5")
                launch_menu_command "$SCRIPT_DIR/bin/status.sh"
''', '''            "CHAR:4")
                launch_menu_command "$SCRIPT_DIR/bin/status.sh"
'''),
    ])

    # The update banner key is inert; updates would rewrite the bundled engine.
    apply(mole, [
        ('''            "UPDATE")
                [[ "${MAIN_MENU_SHOW_UPDATE:-false}" == "true" ]] || continue
                show_cursor
                clear
                update_mole
                exit 0
                ;;
''', '''            "UPDATE")
                continue
                ;;
'''),
    ])

    # CLI dispatch: refuse the dangerous subcommands entirely.
    apply(mole, [
        ('''        "uninstall")
            exec "$SCRIPT_DIR/bin/uninstall.sh" "${args[@]:1}"
            ;;
''', ""),
        ('''        "installer")
            exec "$SCRIPT_DIR/bin/installer.sh" "${args[@]:1}"
            ;;
''', ""),
        ('''        "completion")
            exec "$SCRIPT_DIR/bin/completion.sh" "${args[@]:1}"
            ;;
''', ""),
        ('''        "update")
            local force_update=false
            local nightly_update=false
            for arg in "${args[@]:1}"; do
                case "$arg" in
                    --force | -f) force_update=true ;;
                    --nightly) nightly_update=true ;;
                    *)
                        echo "Unknown update option: $arg"
                        echo "Use 'mole update [--force] [--nightly]' for supported options."
                        exit 1
                        ;;
                esac
            done
            update_mole "$force_update" "$nightly_update"
            exit 0
            ;;
''', ""),
        ('''        "remove")
            local dry_run_remove=false
            for arg in "${args[@]:1}"; do
                case "$arg" in
                    "--dry-run" | "-n") dry_run_remove=true ;;
                    *)
                        echo "Unknown remove option: $arg"
                        echo "Use 'mole remove [--dry-run]' for supported options."
                        exit 1
                        ;;
                esac
            done
            remove_mole "$dry_run_remove"
            ;;
''', ""),
    ])

    print("  done")


if __name__ == "__main__":
    main()
