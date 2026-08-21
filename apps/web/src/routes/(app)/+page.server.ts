import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const c = locals.client!;
  const groups = c.groups();

  const [unread, notifications, personalTasks, personalCal] = await Promise.all([
    c.mail.getUnreadMessages().catch(() => []),
    c.notifications.list().catch(() => []),
    c.tasks.list().catch(() => []),
    c.calendar.list({}).catch(() => []),
  ]);

  // Aggregate group calendar entries (best-effort)
  const groupCals = await Promise.all(
    groups.map((g) =>
      c.calendar
        .list({ group: g.login })
        .then((entries) => entries.map((e) => ({ ...e, _group: g.name_hr ?? g.login })))
        .catch(() => []),
    ),
  );

  const allEvents = [...personalCal.map((e) => ({ ...e, _group: "Persönlich" })), ...groupCals.flat()];
  const now = Math.floor(Date.now() / 1000);
  const upcoming = allEvents
    .filter((e) => e.end_date >= now)
    .sort((a, b) => a.start_date - b.start_date)
    .slice(0, 6);

  // Aggregate group tasks
  const groupTasks = await Promise.all(
    groups.map((g) =>
      c.tasks
        .list(g.login)
        .then((entries) => entries.map((e) => ({ ...e, _group: g.name_hr ?? g.login })))
        .catch(() => []),
    ),
  );
  // A group list holds every task in the room, including ones assigned to other
  // people — those don't belong on a personal dashboard. An assigned task also
  // appears in the caller's personal list, so that list is the filter.
  //
  // It's the deduplication key too: without it, a group task assigned to me
  // showed up twice, once as "Persönlich" and once under its group.
  const assignedIds = new Set(personalTasks.map((t) => String(t.id)));
  const mine = groupTasks.flat().filter((t) => assignedIds.has(String(t.id)));
  const seen = new Set(mine.map((t) => String(t.id)));
  const allTasks = [
    ...mine,
    ...personalTasks.filter((t) => !seen.has(String(t.id))).map((t) => ({ ...t, _group: "Persönlich" })),
  ];
  const openTasks = allTasks
    .filter((t) => !t.completed)
    .sort((a, b) => (a.due_date ?? Infinity) - (b.due_date ?? Infinity))
    .slice(0, 8);

  return {
    unreadCount: unread.length,
    unread: unread.slice(0, 5),
    notifications: notifications.slice(0, 8),
    openTasks,
    upcoming,
  };
};
