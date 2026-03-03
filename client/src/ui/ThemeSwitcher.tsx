import { ALL_THEMES, type CityTheme } from "../pixi/themes";

interface Props {
  currentThemeId: string;
  onSelectTheme: (themeId: string) => void;
}

export function ThemeSwitcher({ currentThemeId, onSelectTheme }: Props) {
  return (
    <div className="theme-switcher">
      {ALL_THEMES.map((theme: CityTheme) => (
        <button
          key={theme.id}
          className={`theme-btn ${currentThemeId === theme.id ? "active" : ""}`}
          onClick={() => onSelectTheme(theme.id)}
          title={theme.name}
        >
          <span className="theme-icon">{theme.icon}</span>
        </button>
      ))}
    </div>
  );
}
