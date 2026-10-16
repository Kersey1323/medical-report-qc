import sys, json, argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.main import create_app

p = argparse.ArgumentParser()
p.add_argument("--output", default="openapi.json")
args = p.parse_args()
Path(args.output).write_text(
    json.dumps(create_app().openapi(), ensure_ascii=False, sort_keys=True, indent=2)
    + "\n"
)
