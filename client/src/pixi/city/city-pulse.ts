export class CityPulse {
  /** Overall activity 0-1 derived from agent count + statuses */
  overallActivity: number = 0;

  /** Per-district intensity */
  districtActivity: Map<string, number> = new Map();

  /** Error flash: decays at 0.95/frame */
  errorFlash: { district: string; intensity: number } | null = null;

  /** Power strain 0-1: tokens used / capacity */
  powerStrain: number = 0;

  /** Milliseconds since last activity */
  idleDuration: number = 0;

  private lastActivityTime: number = 0;

  /** Call when agent statuses change */
  onAgentUpdate(agents: Array<{ status: string; district?: string }>) {
    const statusWeights: Record<string, number> = {
      writing: 1.0,
      reading: 1.0,
      thinking: 0.5,
      stuck: 0.3,
      walking: 0.4,
      idle: 0,
    };

    let totalContribution = 0;
    const districtContributions = new Map<string, number>();
    let anyActive = false;

    for (const agent of agents) {
      const weight = statusWeights[agent.status] ?? 0;
      totalContribution += weight;

      if (weight > 0) {
        anyActive = true;
      }

      if (agent.district) {
        const prev = districtContributions.get(agent.district) ?? 0;
        districtContributions.set(agent.district, prev + weight);
      }
    }

    // Normalize overall activity
    this.overallActivity = totalContribution / Math.max(agents.length, 1);

    // Update per-district activity
    for (const [district, contribution] of districtContributions) {
      const agentsInDistrict = agents.filter((a) => a.district === district).length;
      this.districtActivity.set(district, contribution / Math.max(agentsInDistrict, 1));
    }

    // Reset idle timer if any agent is active
    if (anyActive) {
      this.lastActivityTime = performance.now();
    }
  }

  /** Call when an error/notification occurs */
  onError(district: string) {
    this.errorFlash = { district, intensity: 1.0 };
  }

  /** Call when token stats update */
  onTokenUpdate(tokensUsed: number, capacity: number = 1_000_000) {
    this.powerStrain = Math.min(1, tokensUsed / capacity);
  }

  /** Call every frame with current time in ms */
  update(time: number) {
    // Decay errorFlash intensity by 0.95 per frame
    if (this.errorFlash !== null) {
      this.errorFlash.intensity *= 0.95;
      if (this.errorFlash.intensity < 0.01) {
        this.errorFlash = null;
      }
    }

    // Update idleDuration from lastActivityTime
    if (this.lastActivityTime > 0) {
      this.idleDuration = time - this.lastActivityTime;
    } else {
      // No activity has ever been recorded — treat as immediately idle
      this.idleDuration = time;
    }

    // Decay districtActivity values toward 0 at 0.001/frame
    for (const [district, value] of this.districtActivity) {
      const decayed = value - 0.001;
      if (decayed <= 0) {
        this.districtActivity.delete(district);
      } else {
        this.districtActivity.set(district, decayed);
      }
    }
  }
}
