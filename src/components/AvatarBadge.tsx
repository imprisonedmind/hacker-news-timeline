type AvatarBadgeProps = {
  username: string;
};

export function AvatarBadge({ username }: AvatarBadgeProps) {
  const letter = username.charAt(0).toUpperCase() || "?";
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-hn-orange/30 bg-hn-orange/15 text-sm font-bold text-hn-orange">
      {letter}
    </div>
  );
}
