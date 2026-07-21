import { expect, test, type Page } from "playwright/test";

const eventImageUrl = "/mock-event.png";

const currentMonthDate = (daysFromNow: number, hour: number) => {
  const now = new Date();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    Math.min(now.getDate() + daysFromNow, lastDayOfMonth),
    hour,
    0,
    0,
  ).toISOString();
};

const apiUser = {
  id: 1,
  account_id: 1,
  user_id: 1,
  email: "user@mappening.test",
  login_email: "user@mappening.test",
  first_name: "Alex",
  last_name: "Martin",
  username: "Alex",
  role: "user",
  account_type: "user",
  is_active: true,
  created_at: "2026-07-01T10:00:00Z",
};

const moderatorUser = {
  ...apiUser,
  id: 2,
  account_id: 2,
  user_id: 2,
  email: "moderateur@mappening.test",
  login_email: "moderateur@mappening.test",
  username: "Moderateur",
  role: "moderator",
};

const adminUser = {
  ...apiUser,
  id: 3,
  account_id: 3,
  user_id: 3,
  email: "admin@mappening.test",
  login_email: "admin@mappening.test",
  username: "Admin",
  role: "admin",
};

const organization = {
  id: 10,
  account_id: 1,
  name: "Maison du Port",
  contact_email: "contact@maison-port.test",
  description: "Salle culturelle marseillaise",
  website: "https://maison-port.test",
  address: "1 Quai du Port",
  city: "Marseille",
  postal_code: "13002",
  latitude: 43.2965,
  longitude: 5.3698,
  logo: eventImageUrl,
  is_active: true,
  is_verified: true,
  category_slugs: ["culture"],
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-01T10:00:00Z",
  deleted_at: null,
};

const events = [
  {
    id: 100,
    organization_id: 10,
    title: "Concert solaire",
    description: "Concert en plein air sur le Vieux-Port.",
    address: "1 Quai du Port",
    city: "Marseille",
    postal_code: "13002",
    latitude: 43.2965,
    longitude: 5.3698,
    image: eventImageUrl,
    price: 0,
    ticketing_link: "https://tickets.mappening.test/concert",
    category_slugs: ["musique"],
    start_date: currentMonthDate(2, 18),
    end_date: currentMonthDate(2, 21),
    is_active: true,
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    deleted_at: null,
    organization,
  },
  {
    id: 101,
    organization_id: 10,
    title: "Atelier affiche",
    description: "Atelier graphique participatif.",
    address: "2 Rue de la Republique",
    city: "Marseille",
    postal_code: "13001",
    latitude: 43.299,
    longitude: 5.37,
    image: eventImageUrl,
    price: 12,
    ticketing_link: "",
    category_slugs: ["art"],
    start_date: currentMonthDate(4, 14),
    end_date: currentMonthDate(4, 17),
    is_active: true,
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    deleted_at: null,
    organization,
  },
];

async function mockApi(page: Page) {
  let authenticatedUser = apiUser;

  await page.route("**/api/events", (route) => route.fulfill({ json: events }));
  await page.route("**/api/events?**", (route) => route.fulfill({ json: events }));
  await page.route("**/api/organizations", (route) =>
    route.fulfill({ json: [organization] }),
  );
  await page.route("**/api/auth/login", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      email?: string;
    };
    const user =
      body.email === "admin@mappening.test"
        ? adminUser
        : body.email === "moderateur@mappening.test"
          ? moderatorUser
          : apiUser;
    authenticatedUser = user;
    await route.fulfill({
      json: { ok: true, user },
    });
  });
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: authenticatedUser }),
  );
  await page.route("**/api/me/favorites", (route) =>
    route.fulfill({
      json: [{ id: 1, user_id: 1, event_id: 100, event: events[0], deleted_at: null }],
    }),
  );
  await page.route("**/api/me/history", (route) =>
    route.fulfill({
      json: [{ id: 1, user_id: 1, event_id: 101, event: events[1], deleted_at: null }],
    }),
  );
  await page.route("**/api/me/preferences", (route) =>
    route.fulfill({
      json: [{ id: 1, user_id: 1, event_category_id: 1, created_at: "2026-07-01T10:00:00Z" }],
    }),
  );
  await page.route("**/api/me/notifications", (route) =>
    route.fulfill({
      json: [
        {
          id: 1,
          user_id: 1,
          notification_type_id: 1,
          title: "Organisation validee",
          message: "Votre organisation est maintenant visible.",
          is_read: false,
          created_at: "2026-07-01T10:00:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/notification-types", (route) =>
    route.fulfill({ json: [{ id: 1, slug: "organization_validated", label: "Validation" }] }),
  );
  await page.route("**/api/me/organizations", (route) =>
    route.fulfill({ json: [organization] }),
  );
  await page.route("**/api/organizations/10/members", (route) =>
    route.fulfill({ json: [{ id: 1, organization_id: 10, user_id: 1, job_role: "Owner" }] }),
  );
  await page.route("**/api/staff/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("summary")
        ? {
            accounts: { total: 3, pending: 1 },
            events: { total: 2, pending: 1 },
            organizations: { total: 1, pending: 1 },
            reports: { total: 1, pending: 1 },
          }
        : [],
    }),
  );
  await page.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/mock-event.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      path: "public/pwa-icon-192.png",
    }),
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ json: { daily: { time: [], weather_code: [] } } }),
  );
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill("Password123!");
  await Promise.all([
    page.waitForResponse("**/api/auth/login"),
    page.getByRole("button", { name: "Se connecter" }).click(),
  ]);
  await expect(page).toHaveURL("/");
}

async function seedAuthenticatedSession(
  page: Page,
  user: typeof apiUser | typeof moderatorUser | typeof adminUser = apiUser,
) {
  await page.addInitScript((seedUser) => {
    window.localStorage.setItem(
      "auth-storage-v4",
      JSON.stringify({
        state: {
          isAuthenticated: true,
          currentUser: {
            id: seedUser.account_id,
            account_id: seedUser.account_id,
            user_id: seedUser.user_id,
            login_email: seedUser.login_email,
            username: seedUser.username,
            role: seedUser.role === "moderator" || seedUser.role === "admin"
              ? seedUser.role
              : "user",
            role_id: seedUser.role === "admin" ? 3 : seedUser.role === "moderator" ? 4 : 1,
            is_active: true,
            suspended_until: null,
            suspension_reason: null,
            created_at: seedUser.created_at,
            auth_source: "api",
          },
          role: seedUser.role === "moderator" || seedUser.role === "admin"
            ? seedUser.role
            : "user",
        },
        version: 0,
      }),
    );
  }, user);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("consultation, recherche, filtrage et tri des evenements", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Concert solaire")).toBeVisible();
  await expect(page.getByText("Atelier affiche")).toBeVisible();

  await page.getByRole("button", { name: /rechercher/i }).click();
  await page
    .getByRole("searchbox", { name: /rechercher un evenement/i })
    .last()
    .fill("affiche");
  await expect(page.getByText("Atelier affiche")).toBeVisible();
  await expect(page.getByText("Concert solaire")).toHaveCount(0);

  await page.getByRole("button", { name: /filtres/i }).click();
  await page.getByLabel("Tarif").selectOption("paid");
  await page.getByLabel("Trier par").selectOption("price-desc");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByText("Atelier affiche")).toBeVisible();
});

test("affichage du bandeau hors ligne", async ({ context, page }) => {
  await page.goto("/");

  const offlineBanner = page.getByText("Vous etes hors ligne");
  await expect(offlineBanner).toHaveCount(0);

  await context.setOffline(true);
  await expect(offlineBanner).toBeVisible();

  await context.setOffline(false);
  await expect(offlineBanner).toHaveCount(0);
});

test("inscription, connexion, favoris, historique, preferences et notifications", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Inscription" })).toBeVisible();

  await loginAs(page, "user@mappening.test");
  await seedAuthenticatedSession(page, apiUser);

  await page.goto("/account/favorites");
  await expect(page.getByText("Concert solaire")).toBeVisible();

  await page.goto("/account/history");
  await expect(page.getByText("Atelier affiche")).toBeVisible();

  await page.goto("/account/parameters");
  await expect(page.getByText(/pr.f.rences|param.tres/i).first()).toBeVisible();

  await page.goto("/account/notifications");
  await expect(page.getByText("Organisation validee")).toBeVisible();
});

test("creation organisation et evenement avec acces organisateur", async ({ page }) => {
  await loginAs(page, "user@mappening.test");

  await page.goto("/account/organizations/new");
  await expect(page.getByText(/organisation/i).first()).toBeVisible();

  await page.getByRole("link", { name: "Organisations" }).click();
  await expect(page.getByText("Maison du Port")).toBeVisible();
});

test("validation, moderation, administration et traitement des signalements", async ({
  page,
}) => {
  await loginAs(page, "moderateur@mappening.test");
  await page.goto("/moderation");
  await expect(page.getByText(/moderation|signalements|comptes/i).first()).toBeVisible();

  await page.goto("/administration");
  await expect(page).toHaveURL(/\/$/);

  await loginAs(page, "admin@mappening.test");
  await page.goto("/administration");
  await expect(page.getByText(/administration|comptes|organisations/i).first()).toBeVisible();
});
