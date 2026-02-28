from mesa import Agent, Model
from mesa.time import RandomActivation
from mesa.datacollection import DataCollector


class SocialAgent(Agent):
    """
    5 agents with different behavior modes:
    - talkative: always speaks
    - quiet: speaks rarely
    - mimic: copies last message it heard
    - contrarian: replies with disagreement
    - gossip: repeats a random message it heard earlier
    """

    def __init__(self, unique_id, model, behavior):
        super().__init__(unique_id, model)
        self.behavior = behavior
        self.memory = []   # local short memory (strings)
        self.inbox = []    # messages received this step

    def receive(self, msg: str):
        self.inbox.append(msg)

    def choose_message(self) -> str | None:
        heard = self.inbox[:]  # snapshot
        self.inbox.clear()

        if self.behavior == "talkative":
            return f"A{self.unique_id}: I’m active today."

        if self.behavior == "quiet":
            # 20% chance to speak
            if self.random.random() < 0.2:
                return f"A{self.unique_id}: (quiet) hello."
            return None

        if self.behavior == "mimic":
            if heard:
                return f"A{self.unique_id}: (mimic) {heard[-1]}"
            return f"A{self.unique_id}: (mimic) ..."

        if self.behavior == "contrarian":
            if heard:
                return f"A{self.unique_id}: (contrarian) I disagree with '{heard[-1]}'."
            return f"A{self.unique_id}: (contrarian) I disagree with the vibe."

        if self.behavior == "gossip":
            # store heard messages into memory
            for h in heard:
                self.memory.append(h)
            if self.memory:
                pick = self.random.choice(self.memory)
                return f"A{self.unique_id}: (gossip) did you hear: {pick}"
            return f"A{self.unique_id}: (gossip) nothing to share yet."

        return None

    def step(self):
        msg = self.choose_message()

        # Always store a minimal trace of what it heard this step
        # (useful for debugging)
        if msg:
            self.memory.append(msg)

            # "Neighborhood": for now fixed ring topology
            neighbors = self.model.neighbors[self.unique_id]
            for nid in neighbors:
                self.model.agents_by_id[nid].receive(msg)


class SocietyModel(Model):
    def __init__(self):
        super().__init__()
        self.schedule = RandomActivation(self)

        behaviors = ["talkative", "quiet", "mimic", "contrarian", "gossip"]

        # ring neighborhood: 0 talks to 1 and 4, etc.
        self.neighbors = {
            0: [1, 4],
            1: [0, 2],
            2: [1, 3],
            3: [2, 4],
            4: [3, 0],
        }

        self.agents_by_id = {}

        for i, b in enumerate(behaviors):
            a = SocialAgent(i, self, b)
            self.schedule.add(a)
            self.agents_by_id[i] = a

        self.datacollector = DataCollector(
            model_reporters={},
            agent_reporters={
                "behavior": lambda a: a.behavior,
                "memory_len": lambda a: len(a.memory),
            },
        )

    def step(self):
        self.schedule.step()
        self.datacollector.collect(self)


if __name__ == "__main__":
    model = SocietyModel()

    STEPS = 10
    for t in range(STEPS):
        print(f"\n=== Step {t} ===")
        model.step()

        # Print what each agent last said (if anything)
        for i in range(5):
            a = model.agents_by_id[i]
            last = a.memory[-1] if a.memory else "(no memory yet)"
            print(f"Agent {i:>1} [{a.behavior:>10}] last: {last}")

    # Optional: show memory lengths after simulation
    print("\n=== Memory lengths ===")
    for i in range(5):
        a = model.agents_by_id[i]
        print(f"Agent {i}: {len(a.memory)} items")