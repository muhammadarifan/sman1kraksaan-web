import type {
  Achievement,
  AchievementCategory,
  AchievementLevel,
  Alumnus,
  NewsArticle,
  Partner,
  Program,
  SchoolEvent,
  Statistics,
} from "@/types";

type StrapiRecord = Record<string, unknown>;

type StrapiResponse = {
  data?: StrapiRecord[];
  meta?: {
    pagination?: {
      page?: number;
      pageCount?: number;
    };
  };
};

const fallbackImage = "/logo-sman1kraksaan.png";

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";

  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join(" ").trim();
  }

  const record = value as StrapiRecord;
  if (record.data) return text(record.data);
  if (record.attributes) return text(record.attributes);

  return text(record.text ?? record.label ?? record.name ?? record.title ?? record.value);
}

function paragraphs(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  }

  if (!Array.isArray(value)) {
    const content = text(value);
    return content ? [content] : [];
  }

  return value.map(text).filter(Boolean);
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slug(record: StrapiRecord, fallback: string): string {
  return slugify(text(record.slug) || fallback || text(record.documentId) || String(record.id ?? "item"));
}

function getStrapiUrl(): string {
  const value = process.env.STRAPI_URL?.trim().replace(/\/$/, "");
  if (!value) throw new Error("STRAPI_URL is not configured");
  return value;
}

function mediaUrl(value: unknown): string {
  const baseUrl = getStrapiUrl();
  let media = value;

  if (media && typeof media === "object" && !Array.isArray(media)) {
    const record = media as StrapiRecord;
    media = record.data ?? record;
  }
  if (Array.isArray(media)) media = media[0];
  if (!media || typeof media !== "object") return fallbackImage;

  const record = media as StrapiRecord;
  const attributes = (record.attributes as StrapiRecord | undefined) ?? record;
  const path = text(attributes.url);
  if (!path) return fallbackImage;

  return new URL(path, `${baseUrl}/`).toString();
}

async function fetchCollection(collection: string): Promise<StrapiRecord[]> {
  const baseUrl = getStrapiUrl();
  const token = process.env.STRAPI_API_TOKEN?.trim() || process.env.STRAPI_TOKEN?.trim();
  const records: StrapiRecord[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const url = new URL(`/api/${collection}`, baseUrl);
    url.searchParams.set("populate", "*");
    url.searchParams.set("pagination[page]", String(page));
    url.searchParams.set("pagination[pageSize]", "100");

    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Strapi ${collection} request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as StrapiResponse;
    records.push(...(Array.isArray(payload.data) ? payload.data : []));
    pageCount = payload.meta?.pagination?.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount);

  return records.map((record) => {
    const attributes = record.attributes;
    return attributes && typeof attributes === "object"
      ? { ...record, ...(attributes as StrapiRecord) }
      : record;
  });
}

const achievementCategories: AchievementCategory[] = ["Akademik", "Teknologi", "Olahraga", "Seni"];
const achievementLevels: AchievementLevel[] = ["Sekolah", "Kabupaten", "Provinsi", "Nasional", "Internasional"];

function mapAchievement(record: StrapiRecord): Achievement {
  const title = text(record.title) || "Prestasi SMAN 1 Kraksaan";
  const date = text(record.date ?? record.publishedAt);
  const category = text(record.category) as AchievementCategory;
  const level = text(record.level) as AchievementLevel;
  const media = Array.isArray(record.media) ? record.media : [];

  return {
    slug: slug(record, title),
    title,
    year: number(record.year ?? date.slice(0, 4)),
    category: achievementCategories.includes(category) ? category : "Akademik",
    level: achievementLevels.includes(level) ? level : "Sekolah",
    image: mediaUrl(record.image ?? record.media),
    description: paragraphs(record.description)[0] || title,
    participants: stringList(record.participants ?? record.name),
    documentation: media.slice(1).map(mediaUrl),
  };
}

function mapAlumnus(record: StrapiRecord): Alumnus {
  const name = text(record.name) || "Alumni SMAN 1 Kraksaan";
  const role = text(record.role) || "Alumni";
  const graduationYear = number(record.graduationYear);
  const configuredCategory = text(record.category);
  const category = configuredCategory === "Pendidikan Tinggi" || configuredCategory === "Karier Profesional" || configuredCategory === "Wirausaha"
    ? configuredCategory
    : /mahasiswa|pelajar/i.test(role)
      ? "Pendidikan Tinggi"
      : /founder|owner|wirausaha|pengusaha/i.test(role)
        ? "Wirausaha"
        : "Karier Profesional";
  const timeline = Array.isArray(record.timeline)
    ? record.timeline.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const entry = item as StrapiRecord;
        return [{ year: number(entry.year), label: text(entry.label) }];
      }).filter((item) => item.year && item.label)
    : [];

  return {
    slug: slug(record, name),
    name,
    photo: mediaUrl(record.photo ?? record.media),
    graduationYear,
    destination: text(record.destination ?? record.university ?? record.company) || "SMAN 1 Kraksaan",
    role,
    location: text(record.location) || "Indonesia",
    category,
    bio: paragraphs(record.bio ?? record.description).join(" "),
    timeline: timeline.length
      ? timeline
      : [{ year: graduationYear, label: `Lulus SMAN 1 Kraksaan` }],
  };
}

function mapPartner(record: StrapiRecord): Partner {
  const name = text(record.name) || "Mitra SMAN 1 Kraksaan";
  const configuredType = text(record.type);
  const allowedTypes: Partner["type"][] = [
    "Kuliah Tamu",
    "Kunjungan Edukatif",
    "Beasiswa & Jalur Masuk",
    "Kolaborasi Riset",
    "Kegiatan Sosial",
  ];

  return {
    slug: slug(record, name),
    name,
    logo: text(record.logo) || name,
    logoImage: mediaUrl(record.logoImage ?? record.logoMedia ?? record.media),
    type: allowedTypes.includes(configuredType as Partner["type"])
      ? configuredType as Partner["type"]
      : "Kegiatan Sosial",
    description: paragraphs(record.description).join(" "),
    since: number(record.since ?? record.year),
    website: text(record.website) || undefined,
    programs: stringList(record.programs),
  };
}

function mapNewsArticle(record: StrapiRecord): NewsArticle {
  const title = text(record.title) || "Berita SMAN 1 Kraksaan";
  const content = paragraphs(record.content ?? record.description);

  return {
    slug: slug(record, title),
    title,
    excerpt: text(record.excerpt) || content[0]?.slice(0, 180) || title,
    content: content.length ? content : [title],
    category: text(record.category) || "Berita",
    cover: mediaUrl(record.cover ?? record.media),
    publishedAt: text(record.uploaded ?? record.publishedAt ?? record.createdAt),
    author: text(record.author) || "Humas Sekolah",
    featured: Boolean(record.featured ?? record.highlight),
  };
}

function mapEvent(record: StrapiRecord): SchoolEvent {
  const title = text(record.title) || "Agenda SMAN 1 Kraksaan";
  const date = text(record.date);
  const configuredStatus = text(record.status);

  return {
    slug: slug(record, title),
    title,
    date,
    location: text(record.location) || "SMAN 1 Kraksaan",
    description: paragraphs(record.description).join(" ") || title,
    image: mediaUrl(record.image ?? record.media),
    status: configuredStatus === "Akan Datang" || configuredStatus === "Selesai"
      ? configuredStatus
      : date >= new Date().toISOString().slice(0, 10) ? "Akan Datang" : "Selesai",
  };
}

function mapProgram(record: StrapiRecord): Program {
  const name = text(record.name ?? record.title) || "Program SMAN 1 Kraksaan";

  return {
    slug: slug(record, name),
    name,
    description: paragraphs(record.description).join(" "),
    focus: text(record.focus),
    subjects: stringList(record.subjects),
    facilities: stringList(record.facilities),
    careers: stringList(record.careers),
  };
}

export async function getAchievements(): Promise<Achievement[]> {
  return (await fetchCollection("achievements"))
    .map(mapAchievement)
    .sort((a, b) => b.year - a.year);
}

export async function getAchievement(itemSlug: string): Promise<Achievement | undefined> {
  return (await getAchievements()).find((item) => item.slug === itemSlug);
}

export async function getAlumni(): Promise<Alumnus[]> {
  return (await fetchCollection("alumni-profiles"))
    .map(mapAlumnus)
    .sort((a, b) => b.graduationYear - a.graduationYear);
}

export async function getAlumnus(itemSlug: string): Promise<Alumnus | undefined> {
  return (await getAlumni()).find((item) => item.slug === itemSlug);
}

export async function getPartners(): Promise<Partner[]> {
  return (await fetchCollection("partners")).map(mapPartner);
}

export async function getPartner(itemSlug: string): Promise<Partner | undefined> {
  return (await getPartners()).find((item) => item.slug === itemSlug);
}

export async function getNews(): Promise<NewsArticle[]> {
  return (await fetchCollection("articles"))
    .map(mapNewsArticle)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function getNewsArticle(itemSlug: string): Promise<NewsArticle | undefined> {
  return (await getNews()).find((item) => item.slug === itemSlug);
}

export async function getEvents(): Promise<SchoolEvent[]> {
  return (await fetchCollection("events"))
    .map(mapEvent)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getEvent(itemSlug: string): Promise<SchoolEvent | undefined> {
  return (await getEvents()).find((item) => item.slug === itemSlug);
}

export async function getPrograms(): Promise<Program[]> {
  return (await fetchCollection("programs")).map(mapProgram);
}

export async function getProgram(itemSlug: string): Promise<Program | undefined> {
  return (await getPrograms()).find((item) => item.slug === itemSlug);
}

export async function getStatistics(): Promise<Statistics> {
  const [achievements, alumni, partners, programs] = await Promise.all([
    getAchievements(),
    getAlumni(),
    getPartners(),
    getPrograms(),
  ]);
  const percentage = (category: Alumnus["category"]) =>
    alumni.length ? Math.round((alumni.filter((item) => item.category === category).length / alumni.length) * 100) : 0;

  return {
    achievements: achievements.length,
    alumni: alumni.length,
    partners: partners.length,
    programs: programs.length,
    alumniHigherEd: percentage("Pendidikan Tinggi"),
    alumniProfessional: percentage("Karier Profesional"),
    alumniEntrepreneur: percentage("Wirausaha"),
  };
}
