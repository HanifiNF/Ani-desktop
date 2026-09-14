export interface Creator {
  name: string;
  initials: string;
  photo: string;
  github: { handle: string; url: string };
  discord: string;
  instagram: { handle: string; url: string };
  email?: string;
}

const portrait = (file: string) => `${import.meta.env.BASE_URL}creators/${file}`;

export const CREATORS: readonly Creator[] = [
  {
    name: "Hanifi",
    initials: "H",
    photo: portrait("hanifi.webp"),
    github: { handle: "HanifiNF", url: "https://github.com/HanifiNF" },
    discord: "hnf_fury",
    instagram: { handle: "hanifi.setiawan", url: "https://www.instagram.com/hanifi.setiawan/" },
    email: "hanifisetiawan@gmail.com"
  },
  {
    name: "Pascal",
    initials: "P",
    photo: portrait("pascal.webp"),
    github: { handle: "Pascalrjt", url: "https://github.com/Pascalrjt" },
    discord: "passpspsps",
    instagram: { handle: "not.passss", url: "https://www.instagram.com/not.passss/" },
    email: "pascal.rogerjt@gmail.com"
  }
] as const;
