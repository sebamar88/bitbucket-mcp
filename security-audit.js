#!/usr/bin/env node
/**
 * Security audit script for Bitbucket MCP
 * Checks for potential security vulnerabilities and credential exposure
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECURITY_CHECKS = {
    // Sensitive patterns that should never appear in code
    SENSITIVE_PATTERNS: [
        /password\s*=\s*['"]\w+['"]/gi,
        /token\s*=\s*['"]\w+['"]/gi,
        /secret\s*=\s*['"]\w+['"]/gi,
        /key\s*=\s*['"]\w+['"]/gi,
        /ATB{1,2}[A-Z0-9]{20,}/gi, // Bitbucket app password pattern
        /ghp_[A-Za-z0-9]{36}/gi, // GitHub token pattern
    ],

    // Files to check for sensitive data
    FILES_TO_CHECK: [
        "src/**/*.ts",
        "src/**/*.js",
        "*.js",
        "*.cjs",
        "*.md",
        "README.md",
        ".env.example",
    ],

    // Files that should never contain sensitive data
    CRITICAL_FILES: [
        "README.md",
        ".env.example",
        "package.json",
        "src/index.ts",
    ],
};

class SecurityAuditor {
    constructor() {
        this.issues = [];
        this.warnings = [];
    }

    async audit() {
        console.log("🔐 Starting security audit...\n");

        // Check for sensitive patterns in files
        await this.checkSensitivePatterns();

        // Check environment configuration
        await this.checkEnvironmentConfig();

        // Check logging configuration
        await this.checkLoggingConfig();

        // Check .gitignore
        await this.checkGitignore();

        // Report results
        this.reportResults();
    }

    async checkSensitivePatterns() {
        console.log("📝 Checking for sensitive patterns in code...");

        const filesToCheck = [
            "src/index.ts",
            "test-simple.cjs",
            "test-mcp-client.js",
            "README.md",
            ".env.example",
            "package.json",
        ];

        for (const file of filesToCheck) {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf-8");

                for (const pattern of SECURITY_CHECKS.SENSITIVE_PATTERNS) {
                    const matches = content.match(pattern);
                    if (matches) {
                        this.issues.push({
                            type: "SENSITIVE_DATA",
                            file: file,
                            pattern: pattern.source,
                            matches: matches.length,
                            severity: "HIGH",
                        });
                    }
                }
            }
        }

        console.log("✅ Sensitive pattern check completed");
    }

    async checkEnvironmentConfig() {
        console.log("📝 Checking environment configuration...");

        const envExample = path.join(__dirname, ".env.example");
        const envFile = path.join(__dirname, ".env");

        // Check if .env.example exists and is safe
        if (fs.existsSync(envExample)) {
            const content = fs.readFileSync(envExample, "utf-8");

            // Check for actual credentials in .env.example
            if (content.includes("ATB") || content.includes("ghp_")) {
                this.issues.push({
                    type: "CREDENTIALS_IN_EXAMPLE",
                    file: ".env.example",
                    message: "Real credentials found in .env.example file",
                    severity: "CRITICAL",
                });
            }
        }

        // Check if .env file exists (it should be gitignored)
        if (fs.existsSync(envFile)) {
            this.warnings.push({
                type: "ENV_FILE_EXISTS",
                file: ".env",
                message: "Ensure .env file is properly gitignored",
                severity: "MEDIUM",
            });
        }

        console.log("✅ Environment configuration check completed");
    }

    async checkLoggingConfig() {
        console.log("📝 Checking logging configuration...");

        const indexFile = path.join(__dirname, "src/index.ts");
        if (fs.existsSync(indexFile)) {
            const content = fs.readFileSync(indexFile, "utf-8");

            // Check for proper sanitization methods
            if (!content.includes("sanitizeError")) {
                this.issues.push({
                    type: "MISSING_SANITIZATION",
                    file: "src/index.ts",
                    message: "Missing error sanitization method",
                    severity: "HIGH",
                });
            }

            // Check for sensitive data in logs
            if (content.includes("console.log") && !content.includes("test")) {
                this.warnings.push({
                    type: "CONSOLE_LOGGING",
                    file: "src/index.ts",
                    message:
                        "Found console.log statements - ensure they don't log sensitive data",
                    severity: "MEDIUM",
                });
            }
        }

        console.log("✅ Logging configuration check completed");
    }

    async checkGitignore() {
        console.log("📝 Checking .gitignore configuration...");

        const gitignoreFile = path.join(__dirname, ".gitignore");
        if (fs.existsSync(gitignoreFile)) {
            const content = fs.readFileSync(gitignoreFile, "utf-8");

            const requiredEntries = [".env", "*.log", "logs/"];
            for (const entry of requiredEntries) {
                if (!content.includes(entry)) {
                    this.issues.push({
                        type: "MISSING_GITIGNORE_ENTRY",
                        file: ".gitignore",
                        message: `Missing gitignore entry: ${entry}`,
                        severity: "HIGH",
                    });
                }
            }
        } else {
            this.issues.push({
                type: "MISSING_GITIGNORE",
                file: ".gitignore",
                message: ".gitignore file not found",
                severity: "HIGH",
            });
        }

        console.log("✅ .gitignore check completed");
    }

    reportResults() {
        console.log("\n🔍 Security Audit Results\n");

        if (this.issues.length === 0 && this.warnings.length === 0) {
            console.log("✅ No security issues found!");
            return;
        }

        // Report critical issues
        const criticalIssues = this.issues.filter(
            (issue) => issue.severity === "CRITICAL"
        );
        if (criticalIssues.length > 0) {
            console.log("🚨 CRITICAL ISSUES:");
            criticalIssues.forEach((issue) => {
                console.log(
                    `   ❌ ${issue.type}: ${issue.message || issue.pattern}`
                );
                console.log(`      File: ${issue.file}`);
                console.log("");
            });
        }

        // Report high severity issues
        const highIssues = this.issues.filter(
            (issue) => issue.severity === "HIGH"
        );
        if (highIssues.length > 0) {
            console.log("⚠️  HIGH SEVERITY ISSUES:");
            highIssues.forEach((issue) => {
                console.log(
                    `   ❌ ${issue.type}: ${issue.message || issue.pattern}`
                );
                console.log(`      File: ${issue.file}`);
                console.log("");
            });
        }

        // Report warnings
        if (this.warnings.length > 0) {
            console.log("⚠️  WARNINGS:");
            this.warnings.forEach((warning) => {
                console.log(`   ⚠️  ${warning.type}: ${warning.message}`);
                console.log(`      File: ${warning.file}`);
                console.log("");
            });
        }

        console.log("📋 Summary:");
        console.log(`   Critical Issues: ${criticalIssues.length}`);
        console.log(`   High Severity Issues: ${highIssues.length}`);
        console.log(`   Warnings: ${this.warnings.length}`);
        console.log("");

        if (criticalIssues.length > 0 || highIssues.length > 0) {
            console.log("🔧 Recommendations:");
            console.log("   1. Remove any hardcoded credentials from files");
            console.log(
                "   2. Ensure all sensitive data is properly sanitized in logs"
            );
            console.log("   3. Review and update .gitignore file");
            console.log(
                "   4. Use environment variables for all sensitive configuration"
            );
            console.log("   5. Implement proper error sanitization");
            console.log("");

            process.exit(1);
        } else {
            console.log("✅ All security checks passed!");
        }
    }
}

// Run the audit
const auditor = new SecurityAuditor();
auditor.audit().catch((error) => {
    console.error("❌ Security audit failed:", error);
    process.exit(1);
});
