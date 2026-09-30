import { Brain } from "lucide-react";
import { Link } from "react-router-dom";

const footerLinks = {
  Product: ["Problems", "Contest", "Discuss", "Interview", "Store"],
  Company: ["About", "Careers", "Press", "Blog"],
  Resources: ["Documentation", "API", "Status", "Support"],
  Legal: ["Privacy", "Terms", "Security", "Cookies"],
};

const Footer = () => (
  <footer className="border-t border-border bg-bg-surface">
    <div className="container mx-auto px-4 py-12">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
        <div className="col-span-2 md:col-span-1">
          <Link to="/" className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg gradient-btn flex items-center justify-center">
              <Brain className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">MindCode</span>
          </Link>
          <p className="text-sm text-muted-foreground">
            We don't just test code.<br />We decode thinking.
          </p>
        </div>
        {Object.entries(footerLinks).map(([title, links]) => (
          <div key={title}>
            <h4 className="text-sm font-semibold text-foreground mb-3">{title}</h4>
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link}>
                  <Link to="#" className="text-sm text-muted-foreground hover:text-teal transition-colors">
                    {link}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-10 pt-6 border-t border-border text-center text-xs text-muted-foreground">
        © 2026 MindCode. All rights reserved.
      </div>
    </div>
  </footer>
);

export default Footer;
