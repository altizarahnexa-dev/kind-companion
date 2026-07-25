import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="container mx-auto grid gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary" aria-hidden />
            <span className="font-semibold">Sourcely</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Global sourcing marketplace connecting buyers with verified suppliers worldwide.
          </p>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Buy</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/search" className="hover:text-foreground">Browse products</Link></li>
            <li><Link to="/categories" className="hover:text-foreground">Categories</Link></li>
            <li><Link to="/suppliers" className="hover:text-foreground">Suppliers</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Account</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/account" className="hover:text-foreground">Profile</Link></li>
            <li><Link to="/orders" className="hover:text-foreground">Orders</Link></li>
            <li><Link to="/wishlist" className="hover:text-foreground">Wishlist</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Company</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>About</li><li>Contact</li><li>Privacy</li><li>Terms</li>
          </ul>
        </div>
      </div>
      <div className="border-t py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Sourcely. All rights reserved.
      </div>
    </footer>
  );
}
