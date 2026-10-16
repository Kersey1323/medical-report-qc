"""Render only. Never installs/enables units or changes existing model service5555."""

from pathlib import Path
import argparse
import yaml


def render_units(config, output_dir):
    root = Path(config["project_root"]).resolve()
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    values = {
        "PROJECT": str(root),
        "BUSINESS_PYTHON": config["business_python"],
        "RETRIEVAL_PYTHON": config["retrieval_python"],
        "USER": config["user"],
    }
    if values["USER"] == "root":
        raise ValueError("Use a low privilege user")
    paths = []
    for template in sorted(
        (Path(__file__).resolve().parents[1] / "systemd").glob("*.in")
    ):
        text = template.read_text()
        for key, value in values.items():
            text = text.replace("@" + key + "@", value)
        if "@" in text:
            raise ValueError("Unresolved unit variable")
        path = out / template.name.removesuffix(".in")
        path.write_text(text)
        paths.append(path)
    return paths


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="configs/deployment.local.yaml")
    p.add_argument("--output", required=True)
    a = p.parse_args()
    for path in render_units(
        yaml.safe_load(Path(a.config).read_text()), Path(a.output)
    ):
        print(path)
