import Navbar from "@/components/Navbar";
import GlowButton from "@/components/GlowButton";
import { useAssessmentSession } from "@/hooks/useAssessmentSession";
import useSupabaseAuth from "@/hooks/useSupabaseAuth";
import { getSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";

type ProfilePrefs = {
  headline: string;
  location: string;
  about: string;
  preferredLanguage: string;
  difficultyBias: string;
  github: string;
  linkedin: string;
};

const defaultPrefs: ProfilePrefs = {
  headline: "",
  location: "",
  about: "",
  preferredLanguage: "python",
  difficultyBias: "Balanced",
  github: "",
  linkedin: "",
};

const makeGrid = (activity: Record<string, number>) => {
  const cells: { key: string; level: number }[] = [];
  const today = new Date();
  for (let w = 51; w >= 0; w -= 1) {
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - (w * 7 + (6 - d)));
      const key = date.toISOString().slice(0, 10);
      const count = activity[key] || 0;
      const level = count === 0 ? 0 : Math.min(4, count);
      cells.push({ key, level });
    }
  }
  const weeks: { key: string; level: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
};

const Profile = () => {
  const navigate = useNavigate();
  const { user } = useSupabaseAuth();
  const { reports, loadReports } = useAssessmentSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<ProfilePrefs>(defaultPrefs);
  const [photo, setPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadReports().catch(() => {});
  }, [loadReports]);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email || "");
    setName((user.user_metadata as any)?.name || "");

    if (!hasSupabaseEnv) return;
    const supa = getSupabaseClient();
    void (async () => {
      try {
        const { data } = await supa
          .from("users")
          .select("name,email,headline,location,about,preferred_language,difficulty_bias,github_url,linkedin_url,photo_data")
          .eq("id", user.id)
          .maybeSingle();
        if (!data) return;
        if (data.name) setName(data.name);
        if (data.email) setEmail(data.email);
        setPrefs({
          headline: data.headline || "",
          location: data.location || "",
          about: data.about || "",
          preferredLanguage: data.preferred_language || "python",
          difficultyBias: data.difficulty_bias || "Balanced",
          github: data.github_url || "",
          linkedin: data.linkedin_url || "",
        });
        if (data.photo_data) setPhoto(data.photo_data);
      } catch {
        // Ignore profile fetch failures and keep auth-derived defaults.
      }
    })();
  }, [user]);

  const activity = useMemo(() => {
    return reports.reduce<Record<string, number>>((acc, r) => {
      const key = new Date(r.createdAt).toISOString().slice(0, 10);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [reports]);

  const weeks = useMemo(() => makeGrid(activity), [activity]);
  const activeDays = useMemo(() => Object.keys(activity).length, [activity]);

  const onPickPhoto = () => fileRef.current?.click();

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setPhoto(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const onSave = async () => {
    if (!user) return;
    setSaving(true);
    setStatus(null);
    try {
      if (hasSupabaseEnv) {
        const supa = getSupabaseClient();
        const { error } = await supa.from("users").upsert({
          id: user.id,
          name,
          email,
          headline: prefs.headline,
          location: prefs.location,
          about: prefs.about,
          preferred_language: prefs.preferredLanguage,
          difficulty_bias: prefs.difficultyBias,
          github_url: prefs.github,
          linkedin_url: prefs.linkedin,
          photo_data: photo || null,
        });
        if (error) throw error;
      }
      setStatus("Profile saved.");
    } catch {
      setStatus("Unable to save profile.");
    } finally {
      setSaving(false);
    }
  };

  const onLogout = async () => {
    setLoggingOut(true);
    setStatus(null);
    try {
      if (hasSupabaseEnv) {
        const supa = getSupabaseClient();
        await supa.auth.signOut();
      }
      navigate("/login", { replace: true });
    } catch {
      setStatus("Unable to log out right now.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-12 space-y-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Account & signal</p>
            <h1 className="text-3xl font-bold">Profile</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-btn border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
              onClick={onLogout}
              disabled={loggingOut}
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
            <GlowButton size="sm" onClick={onSave} disabled={saving || !user || loggingOut}>{saving ? "Saving..." : "Save"}</GlowButton>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-card border border-border bg-gradient-to-r from-teal/10 via-bg-surface to-indigo-900/20 p-6">
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                {photo ? (
                  <img src={photo} alt="Profile" className="w-20 h-20 rounded-2xl object-cover border-2 border-teal/60" />
                ) : (
                  <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-border bg-bg-hover flex items-center justify-center text-xs text-muted-foreground">No photo</div>
                )}
                <button onClick={onPickPhoto} className="absolute -bottom-2 -right-2 px-3 py-1 text-xs rounded-btn bg-bg-surface border border-border">Change</button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Signal-ready</p>
                <h2 className="text-2xl font-semibold">{name || "Unnamed user"}</h2>
                <p className="text-sm text-muted-foreground">{prefs.headline || "Set your headline"}</p>
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <span className="px-2 py-1 rounded-btn bg-bg-surface border border-border">Active days {activeDays}</span>
                  <span className="px-2 py-1 rounded-btn bg-bg-surface border border-border">Reports {reports.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {status && <p className="text-sm text-muted-foreground">{status}</p>}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-card rounded-card p-5 border border-border space-y-4">
            <h3 className="font-semibold text-foreground">Identity</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <input className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Headline</p>
                <input className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={prefs.headline} onChange={(e) => setPrefs((p) => ({ ...p, headline: e.target.value }))} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <input className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <input className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={prefs.location} onChange={(e) => setPrefs((p) => ({ ...p, location: e.target.value }))} />
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">About</p>
              <textarea className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" rows={4} value={prefs.about} onChange={(e) => setPrefs((p) => ({ ...p, about: e.target.value }))} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Preferred Language</p>
                <select className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={prefs.preferredLanguage} onChange={(e) => setPrefs((p) => ({ ...p, preferredLanguage: e.target.value }))}>
                  <option>python</option>
                  <option>javascript</option>
                  <option>java</option>
                  <option>cpp</option>
                  <option>c</option>
                  <option>go</option>
                  <option>rust</option>
                </select>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Difficulty Bias</p>
                <select className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={prefs.difficultyBias} onChange={(e) => setPrefs((p) => ({ ...p, difficultyBias: e.target.value }))}>
                  <option>Balanced</option>
                  <option>Hard-first</option>
                  <option>Medium-focused</option>
                  <option>Easy warmups</option>
                </select>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">LinkedIn</p>
                <input className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={prefs.linkedin} onChange={(e) => setPrefs((p) => ({ ...p, linkedin: e.target.value }))} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">GitHub</p>
                <input className="w-full mt-1 px-3 py-2 rounded-btn bg-bg-hover border border-border" value={prefs.github} onChange={(e) => setPrefs((p) => ({ ...p, github: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass-card rounded-card p-5 border border-border">
              <h3 className="font-semibold text-foreground mb-3">Signal snapshot</h3>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between"><span>Assessments</span><span className="text-teal">{reports.length}</span></div>
                <div className="flex items-center justify-between"><span>Active days</span><span className="text-ice">{activeDays}</span></div>
                <div className="flex items-center justify-between"><span>Preferred language</span><span className="text-foreground uppercase">{prefs.preferredLanguage}</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-muted-foreground">365-day signal footprint</p>
              <h3 className="font-semibold">Activity heatmap</h3>
            </div>
            <span className="text-xs text-muted-foreground">{activeDays} active days</span>
          </div>
          <div className="grid grid-cols-[repeat(52,1fr)] gap-[2px] overflow-x-auto">
            {weeks.map((week, i) => (
              <div key={`w-${i}`} className="grid gap-[2px]" style={{ gridTemplateRows: "repeat(7, 1fr)" }}>
                {week.map((cell) => (
                  <div key={cell.key} className="aspect-square rounded-sm" style={{ backgroundColor: cell.level === 0 ? "hsl(210,15%,12%)" : `rgba(0,212,170,${0.2 + cell.level * 0.18})` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Profile;
