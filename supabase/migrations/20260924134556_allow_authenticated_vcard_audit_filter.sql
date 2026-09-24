-- The contacts INSERT trigger evaluates this SECURITY INVOKER predicate in
-- the inserting user's role. Its previous EXECUTE revocation raised 42501
-- before an authenticated vCard import could insert even the first contact.
-- The function only inspects the passed notes text and lives in private.
grant execute on function private.gurminik_skip_vcard_audit(text) to authenticated;
