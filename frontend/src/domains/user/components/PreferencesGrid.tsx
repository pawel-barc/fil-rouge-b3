import { EVENT_CATEGORIES } from "../../event/types/event-categories";
import type { EventCategory } from "../../event/types/event-categories";
import PreferenceCard from "./PreferenceCard";

type Props = {
  selected: EventCategory[];
  toggle: (category: EventCategory) => void;
};

const SORTED_EVENT_CATEGORIES = [...EVENT_CATEGORIES].sort((first, second) =>
  first.localeCompare(second, "fr-FR"),
);

export default function PreferencesGrid({ selected, toggle }: Props) {
  return (
    <div
      className="preferences-grid"
      role="group"
      aria-label="Préférences d'événements"
    >
      {SORTED_EVENT_CATEGORIES.map((category) => (
        <PreferenceCard
          key={category}
          category={category}
          selected={selected.includes(category)}
          onClick={() => toggle(category)}
        />
      ))}
    </div>
  );
}
