import Button from "../../../shared/components/ui/Button";
import {
  getEventCategoryLabel,
  type EventCategory,
} from "../../event/types/event-categories";

type Props = {
  category: EventCategory;
  selected: boolean;
  onClick: () => void;
};

/**Carte cliquable représentant une catégorie de préférence */
export default function PreferenceCard({ category, selected, onClick }: Props) {
  return (
    <Button
      type="button"
      className={`preference-card${selected ? " preference-card--selected" : ""}`}
      aria-pressed={selected}
      variant="secondary"
      onClick={onClick}
    >
      {getEventCategoryLabel(category)}
    </Button>
  );
}
