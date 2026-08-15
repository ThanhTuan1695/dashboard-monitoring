/**
 * Operator device-visibility scoping. Admins always see/manage everything.
 * An operator with an empty `groups` array is unrestricted (so introducing
 * groups doesn't silently lock out existing operators who were never
 * assigned any). Ungrouped devices (`group: ''`) are visible to everyone,
 * restricted or not — they haven't been sorted into a group yet.
 */

function isRestrictedOperator(actingUser) {
  return actingUser.role === 'operator' && Array.isArray(actingUser.groups) && actingUser.groups.length > 0;
}

/** Mongo filter fragment for the devices an operator may see, or null if unrestricted. */
function deviceVisibilityFilter(actingUser) {
  if (!isRestrictedOperator(actingUser)) return null;
  return { $or: [{ group: { $in: actingUser.groups } }, { group: '' }] };
}

/** True if `actingUser` may see/manage this specific device. */
function canAccessDevice(actingUser, device) {
  if (!isRestrictedOperator(actingUser)) return true;
  const group = device.group || '';
  return group === '' || actingUser.groups.includes(group);
}

module.exports = { isRestrictedOperator, deviceVisibilityFilter, canAccessDevice };
