import argparse
import csv
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

# Avoid local file shadowing the installed `mesa` package when this file is named `mesa.py`.
THIS_DIR = Path(__file__).resolve().parent
sys.path = [p for p in sys.path if Path(p or ".").resolve() != THIS_DIR]

from mesa import Agent, Model
from mesa.time import RandomActivation


class Person(Agent):
    def __init__(self, unique_id: int, model: "Society", agent_id: str, segment: str):
        super().__init__(unique_id, model)
        self.agent_id = agent_id
        self.segment = segment

    def step(self) -> None:
        for convo_index in range(self.model.convos_per_agent_per_day):
            prefer_same_segment = convo_index == 0
            partner = self.model.pick_partner(self.agent_id, prefer_same_segment)
            if partner is not None:
                self.model.register_pair(self.agent_id, partner)


class Society(Model):
    def __init__(
        self,
        csv_path: str,
        inter_segment_ratio: float = 0.15,
        convos_per_agent_per_day: int = 2,
        seed: int = 1,
        run_id: str | None = None,
    ):
        super().__init__()
        random.seed(seed)

        self.inter_segment_ratio = inter_segment_ratio
        self.convos_per_agent_per_day = convos_per_agent_per_day
        self.schedule = RandomActivation(self)
        self.pairs_today: set[tuple[str, str]] = set()

        rows = self._load_rows(csv_path, run_id)
        self.agent_ids = [row["agent_id"] for row in rows]
        self.segment_of = {row["agent_id"]: row["segment_region"] for row in rows}

        self.segment_to_ids: dict[str, list[str]] = defaultdict(list)
        for agent_id in self.agent_ids:
            self.segment_to_ids[self.segment_of[agent_id]].append(agent_id)

        for idx, agent_id in enumerate(self.agent_ids):
            self.schedule.add(Person(idx, self, agent_id, self.segment_of[agent_id]))

    @staticmethod
    def _load_rows(csv_path: str, run_id: str | None) -> list[dict[str, str]]:
        with open(csv_path, "r", newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))

        if not rows:
            raise ValueError(f"No rows found in {csv_path}")

        required_cols = {"agent_id", "segment_region", "run_id"}
        missing = required_cols.difference(rows[0].keys())
        if missing:
            raise ValueError(f"Missing required CSV columns: {sorted(missing)}")

        target_run_id = run_id if run_id is not None else rows[0]["run_id"]
        filtered = [r for r in rows if r["run_id"] == target_run_id]
        if not filtered:
            raise ValueError(f"No rows found for run_id={target_run_id}")
        return filtered

    def register_pair(self, a_id: str, b_id: str) -> None:
        if a_id == b_id:
            return
        x, y = (a_id, b_id) if a_id < b_id else (b_id, a_id)
        self.pairs_today.add((x, y))

    def pick_partner(self, a_id: str, prefer_same_segment: bool) -> str | None:
        segment = self.segment_of[a_id]

        if prefer_same_segment:
            choose_same_segment = random.random() < (1 - self.inter_segment_ratio)
        else:
            choose_same_segment = random.random() < max(
                0.5, min(0.9, 1 - 2 * self.inter_segment_ratio)
            )

        if choose_same_segment:
            pool = self.segment_to_ids.get(segment, [])
        else:
            other_segments = [s for s in self.segment_to_ids if s != segment]
            if not other_segments:
                pool = self.segment_to_ids.get(segment, [])
            else:
                pool = self.segment_to_ids[random.choice(other_segments)]

        if len(pool) <= 1:
            return None

        partner = random.choice(pool)
        while partner == a_id:
            partner = random.choice(pool)
        return partner

    def step(self) -> list[tuple[str, str]]:
        self.pairs_today.clear()
        self.schedule.step()
        return sorted(self.pairs_today)


def run_simulation(
    csv_path: str,
    days: int,
    inter_segment_ratio: float,
    convos_per_agent_per_day: int,
    seed: int,
    output_dir: str | None,
    run_id: str | None,
) -> None:
    model = Society(
        csv_path=csv_path,
        inter_segment_ratio=inter_segment_ratio,
        convos_per_agent_per_day=convos_per_agent_per_day,
        seed=seed,
        run_id=run_id,
    )

    output_path = Path(output_dir) if output_dir else None
    if output_path:
        output_path.mkdir(parents=True, exist_ok=True)

    for day in range(1, days + 1):
        pairs = model.step()
        print(f"day={day} pair_count={len(pairs)} sample={pairs[:5]}")

        if output_path:
            out_file = output_path / f"pairs_day_{day:02d}.json"
            out_file.write_text(json.dumps(pairs, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate per-day conversation pairs from a planner CSV."
    )
    parser.add_argument("--csv", default="data.csv", help="Path to planner CSV.")
    parser.add_argument("--days", type=int, default=10, help="Number of days to run.")
    parser.add_argument(
        "--inter-segment-ratio",
        type=float,
        default=0.15,
        help="Chance to mix across segments.",
    )
    parser.add_argument(
        "--convos-per-agent-per-day",
        type=int,
        default=2,
        help="Conversation attempts each agent makes per day.",
    )
    parser.add_argument("--seed", type=int, default=1, help="Random seed.")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Optional directory for pairs_day_XX.json outputs.",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Optional run_id filter. Defaults to first run_id in CSV.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_simulation(
        csv_path=args.csv,
        days=args.days,
        inter_segment_ratio=args.inter_segment_ratio,
        convos_per_agent_per_day=args.convos_per_agent_per_day,
        seed=args.seed,
        output_dir=args.output_dir,
        run_id=args.run_id,
    )
