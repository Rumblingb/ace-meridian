import { create } from "zustand";

export interface JourneyLeg {
  id: string;
  type: "train" | "flight" | "bus" | "hotel";
  service: string;
  departureTime: string;
  arrivalTime: string;
  platform?: string;
  status: "on_time" | "delayed" | "cancelled";
  delayMinutes?: number;
  origin: string;
  destination: string;
}

export interface ActiveJourney {
  id: string;
  legs: JourneyLeg[];
  currentLegIndex: number;
}

interface JourneyState {
  activeJourney: ActiveJourney | null;
  setActiveJourney: (journey: ActiveJourney | null) => void;
  updateLegStatus: (legId: string, status: JourneyLeg["status"], delayMinutes?: number) => void;
}

export const useJourneyStore = create<JourneyState>((set) => ({
  activeJourney: null,
  setActiveJourney: (journey) => set({ activeJourney: journey }),
  updateLegStatus: (legId, status, delayMinutes) =>
    set((state) => {
      if (!state.activeJourney) return state;
      return {
        activeJourney: {
          ...state.activeJourney,
          legs: state.activeJourney.legs.map((leg) =>
            leg.id === legId ? { ...leg, status, delayMinutes } : leg
          ),
        },
      };
    }),
}));
