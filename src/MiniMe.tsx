import { useEffect, useState } from "react";
import { Activity, Check, ChevronLeft, Home, MessageCircle, Moon, Settings, Sparkles, Sun } from "lucide-react";

type Profile = {
  name: string;
  status: "Active" | "Away";
  personality: string[];
  energy: "Chill" | "Energetic" | "Balanced";
  values: string[];
  words: string;
  story: string;
};
type ApiResult = Record<string, any>;
const defaults: Profile = {
  name: "Menelik", status: "Active",
  personality: ["Warm", "Patient", "Focused", "Caring"], energy: "Balanced",
  values: ["Quality", "Relationships", "Creativity"],
  words: "I treat everyone like a friend — warm and welcoming, never pushy.", story: ""
};
const personality = [
  {label:"Funny",emoji:"😄"},{label:"Warm",emoji:"🤗"},{label:"Direct",emoji:"⚡"},
  {label:"Patient",emoji:"🧘"},{label:"Playful",emoji:"😎"},{label:"Focused",emoji:"🎯"},
  {label:"Humble",emoji:"🙏"},{label:"Confident",emoji:"💪"},{label:"Storyteller",emoji:"📖"},
  {label:"Caring",emoji:"❤️"},{label:"Creative",emoji:"🎨"},{label:"Curious",emoji:"🔎"}
];
const values = [
  {label:"Quality",emoji:"🏆"},{label:"Relationships",emoji:"🤝"},{label:"Speed",emoji:"⏱️"},
  {label:"Honesty",emoji:"💯"},{label:"Creativity",emoji:"🎨"},{label:"Value",emoji:"💰"},
  {label:"Growth",emoji:"🌱"},{label:"Trust",emoji:"🛡️"},{label:"Family",emoji:"🏡"}
];
const energies = [{label:"Chill",emoji:"🌊"},{label:"Energetic",emoji:"⚡"},{label:"Balanced",emoji:"⚖️"}];

export default function MiniMe({ flash, apiRequest, readJson }: {
  flash: (message: string) => void;
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>;
  readJson: (r: Response) => Promise<ApiResult>;
}) {
  const [profile, setProfile] = useState<Profile>(defaults);
  const [saved, setSaved] = useState<Profile>(defaults);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [night, setNight] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest("/api/agent/minime")
      .then(async response => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Could not load MiniMe profile.");
        const next = { ...defaults, ...(data.profile || {}) } as Profile;
        if (active) { setProfile(next); setSaved(next); setLoadError(""); }
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : "Could not load MiniMe profile.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.minimeTheme = night ? "night" : "day";
    return () => { delete document.documentElement.dataset.minimeTheme; };
  }, [night]);

  const update = (patch: Partial<Profile>) => setProfile(previous => ({ ...previous, ...patch }));
  const toggle = (field: "personality" | "values", label: string, max: number) => {
    const selected = profile[field];
    if (selected.includes(label)) update({ [field]: selected.filter(item => item !== label) });
    else if (selected.length < max) update({ [field]: [...selected, label] });
    else flash(`Choose up to ${max} ${field === "personality" ? "personality traits" : "values"}.`);
  };
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved);
  const save = async () => {
    setSaving(true);
    try {
      const response = await apiRequest("/api/agent/minime", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not save MiniMe profile.");
      const next = { ...defaults, ...(data.profile || profile) } as Profile;
      setProfile(next); setSaved(next);
      flash("MiniMe profile saved. New Telegram replies will use it.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save MiniMe profile.");
    } finally { setSaving(false); }
  };
  const selectedTraits = profile.personality.map(label => personality.find(item => item.label === label)).filter(Boolean);
  const renderOptions = (items: typeof personality, field: "personality" | "values", max: number) => (
    <div className="minime-options-grid">
      {items.map(item => {
        const active = profile[field].includes(item.label);
        const locked = !active && profile[field].length >= max;
        return <button type="button" key={item.label} className={`minime-option ${active ? "selected" : ""} ${locked ? "locked" : ""}`} aria-pressed={active} onClick={() => toggle(field, item.label, max)}>
          <span>{item.emoji}</span>{item.label}{active ? <Check size={13} /> : null}
        </button>;
      })}
    </div>
  );

  return <section className={`minime-page ${night ? "minime-night" : ""}`}>
    <header className="minime-appbar">
      <button type="button" aria-label="Back" onClick={() => flash("You are in MiniMe profile settings.")}><ChevronLeft size={25}/></button>
      <b>MiniMe</b>
      <button type="button" className="minime-appbar-action" aria-label="Toggle theme" onClick={() => setNight(value => !value)}>{night ? <Sun size={21}/> : <Moon size={21}/>}</button>
      <button type="button" aria-label="More options" onClick={() => flash("Your MiniMe profile is stored securely in the app database.")}>⋮</button>
    </header>
    <div className="minime-profile-strip">
      <div><span>WORKING LATE</span><strong>{profile.name}</strong></div>
      <button type="button" className="minime-active-pill" onClick={() => update({ status: profile.status === "Active" ? "Away" : "Active" })}>
        <i className={profile.status === "Active" ? "is-active" : ""}/>{profile.status}
      </button>
    </div>
    <div className="minime-content">
      {loading ? <div className="minime-card" role="status">Loading your saved MiniMe profile…</div> : null}
      {!loading && loadError ? <div className="minime-card" role="alert"><strong>Could not load MiniMe settings.</strong><p>{loadError}</p><button type="button" className="minime-option selected" onClick={() => window.location.reload()}>Retry</button></div> : null}
      <section className="minime-summary">
        <div className="minime-overline">YOUR MINIME</div>
        <div className="minime-chip-row">
          {selectedTraits.map(item => item && <span className="minime-summary-chip" key={item.label}>{item.emoji} {item.label}</span>)}
          {profile.values.slice(0, 2).map(label => { const item = values.find(value => value.label === label); return <span className="minime-summary-chip" key={label}>{item?.emoji} {label}</span>; })}
        </div>
        <p>“{profile.words || "Tell your story in your own words."}”</p>
      </section>
      <section className="minime-card"><div className="minime-section-title">PERSONALITY <span>(UP TO 4)</span></div>{renderOptions(personality, "personality", 4)}</section>
      <section className="minime-card"><div className="minime-section-title">ENERGY</div><div className="minime-energy-row">
        {energies.map(item => <button type="button" key={item.label} className={`minime-option ${profile.energy === item.label ? "selected" : ""}`} aria-pressed={profile.energy === item.label} onClick={() => update({ energy: item.label as Profile["energy"] })}><span>{item.emoji}</span>{item.label}</button>)}
      </div></section>
      <section className="minime-card"><div className="minime-section-title">VALUES <span>(UP TO 3)</span></div>{renderOptions(values, "values", 3)}</section>
      <section className="minime-card minime-words-card"><label className="minime-section-title" htmlFor="minime-words">IN YOUR WORDS</label><textarea id="minime-words" maxLength={300} value={profile.words} onChange={event => update({ words: event.target.value })} placeholder="Describe how you treat people…"/><div className="minime-field-count">{profile.words.length}/300</div></section>
      <section className="minime-card minime-story-card"><label className="minime-section-title" htmlFor="minime-story">YOUR STORY <span>(OPTIONAL)</span></label><textarea id="minime-story" maxLength={1200} value={profile.story} onChange={event => update({ story: event.target.value })} placeholder={'e.g. "Started selling bags 3 years ago because I couldn’t find good ones in Addis."'} /></section>
      <div className="minime-save-area"><button type="button" className="minime-save-button" disabled={loading || !!loadError || saving || !dirty} onClick={() => void save()}>{loading ? "Loading…" : saving ? "Saving…" : dirty ? "Save changes" : "Changes saved"}<span>{dirty ? "" : "✓"}</span></button></div>
    </div>
    <nav className="minime-bottom-nav" aria-label="Main navigation">
      {[{label:"Home",icon:Home},{label:"Chats",icon:MessageCircle},{label:"MiniMe",icon:Sparkles},{label:"Progress",icon:Activity},{label:"Settings",icon:Settings}].map(item => <button type="button" key={item.label} className={item.label === "MiniMe" ? "active" : ""} onClick={() => item.label === "MiniMe" ? window.scrollTo({top:0,behavior:"smooth"}) : flash(item.label + " section is part of the Telegram Agent dashboard.")}><item.icon size={19}/><span>{item.label}</span></button>)}
    </nav>
  </section>;
}
