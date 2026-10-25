import type { ProjectId, RouterProfile } from "@t3tools/contracts";
import type { ProjectProfile } from "@t3tools/router/profile";

export const toRouterProfile = (
  projectId: ProjectId,
  profile: ProjectProfile | undefined,
): RouterProfile | null =>
  profile === undefined
    ? null
    : {
        projectId,
        slug: profile.slug,
        name: profile.name,
        aliases: profile.aliases,
        description: profile.description,
        stack: profile.stack,
        keywords: profile.keywords,
      };
