"""Read-only code probes; callers must supply a disposable HOME and data roots."""
import importlib
import json
import os
import sys

sys.path.insert(0, os.path.abspath(sys.argv[1]))
from md_cg import generation

report = generation.verify_delegations()
report["fingerprint"] = generation.STARTUP_FINGERPRINT[:12]
report["python"] = sys.version.split()[0]
if "--features" in sys.argv:
    checks = {}

    def probe(name, fn):
        try:
            checks[name] = {"returned": fn()}
        except Exception as exc:
            checks[name] = {"exception": type(exc).__name__, "message": str(exc)}

    from md_cg.whitebox_kb.aeis_core.api import Agent
    agent = Agent(db_path=":memory:")
    # Deliberately exercise unavailable extensions with synthetic, local input.
    probe("aeis_ingest_text", lambda: agent.ingest_text("offline diagnostic synthetic text"))
    probe("aeis_channel_credibility", agent.channel_credibility)
    probe("aeis_nightly_cleanup", lambda: agent.nightly_cleanup(dry_run=True))
    probe("aeis_roleplay_chat", lambda: agent.roleplay_chat("hello"))
    for name in ("world3d", "voxel_world", "world_server", "scene_simulator",
                 "spacetime_consistency", "world_model", "world_learner",
                 "curiosity_explorer", "seven_layer_loop", "world_generator",
                 "world_semantics", "vprim_query"):
        probe("aeis_" + name, lambda name=name: getattr(agent.engine, name)("status"))
    agent.close()
    probe("condition_algebra_import", lambda: importlib.import_module(
        "md_cg.whitebox_kb.wisdom.condition_algebra").__name__)
    from md_cg.whitebox_kb.wisdom import compose_engine
    query = "高压锅在高原上煮饭为什么能熟？"
    probe("compose_serial", lambda: compose_engine.compose_recursive(query))
    probe("compose_parallel_without_numpy", lambda: compose_engine.compose_recursive_parallel(query))
    # Observe imports during the encoding probe without changing their behavior.
    import builtins
    real_import = builtins.__import__
    observed_imports = set()

    def observed_import(name, *args, **kwargs):
        observed_imports.add(name)
        return real_import(name, *args, **kwargs)

    builtins.__import__ = observed_import
    try:
        from md_cg import whitebox
        import sqlite3
        fact = "离线诊断项目七三九的测试颜色是青色。"
        client = whitebox.WhiteboxClient()
        try:
            probe("whitebox_encode_recall", lambda: whitebox.verify_encoding(
                client=client, marker="青色", fact=fact,
                question="离线诊断项目七三九的测试颜色是什么？"))
            with sqlite3.connect("file:" + client.engine.db_path + "?mode=ro", uri=True) as conn:
                checks["whitebox_fact_on_disk"] = conn.execute(
                    "SELECT count(*) FROM nodes WHERE content = ?", (fact,)).fetchone()[0]
        finally:
            client.close()
    finally:
        builtins.__import__ = real_import
    checks["encoding_observed_imports"] = sorted(observed_imports)
    report["features"] = checks

print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
