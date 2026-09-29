"""Curated compliance references exposed alongside Model 13 RAG results.

These entries expand reference coverage only. They are not treated as active
pass/fail controls unless the upload pipeline has an evidence-backed rule.
"""

COMPLIANCE_REFERENCE_CATALOG = [
    ("NIST SP 800-57", "Key-management guidance for cryptographic systems and lifecycle controls."),
    ("NIST SP 800-53", "Security and privacy control catalog with cryptographic protection controls."),
    ("FIPS 140-3 / ISO/IEC 19790", "Security requirements for cryptographic modules."),
    ("NSA CNSA 2.0", "Cryptographic modernization and post-quantum transition guidance."),
    ("NIST FIPS 203/204/205", "Post-quantum standards for key encapsulation and digital signatures."),
    ("PCI DSS v4.0", "Payment-card cryptography, key protection, and secure implementation requirements."),
    ("ISO/IEC 27001", "Information-security management controls for cryptography and key management."),
    ("CERT-In Directions", "Indian cybersecurity incident and protection guidance for covered systems."),
    ("DPDP Act 2023", "Indian digital personal-data protection and security obligations."),
    ("GDPR", "European personal-data protection and security-of-processing obligations."),
    ("HIPAA Security Rule", "Safeguards for electronic protected health information."),
    ("SOC 2", "Trust-services criteria covering security, confidentiality, and availability controls."),
    ("Common Criteria", "Security evaluation criteria and protection-profile requirements."),
    ("IEC 62443", "Industrial automation and control-system cybersecurity requirements."),
    ("NERC CIP", "Critical-infrastructure cybersecurity controls for bulk electric systems."),
    ("W3C XML Encryption", "XML encryption interoperability and algorithm-profile references."),
]


def compliance_reference_matches(query: str, limit: int = 8) -> list[dict]:
    text = (query or "").lower()
    terms = {term for term in text.replace("/", " ").replace("-", " ").split() if len(term) > 2}
    scored = []
    for title, summary in COMPLIANCE_REFERENCE_CATALOG:
        haystack = f"{title} {summary}".lower()
        score = sum(1 for term in terms if term in haystack)
        if score or any(word in text for word in ("compliance", "standard", "framework", "audit", "policy")):
            scored.append({
                "chunk_id": f"COMPLIANCE-REFERENCE-{title.upper().replace('/', '-').replace(' ', '-')}",
                "title": title,
                "content": summary,
                "source": "ECDAT curated compliance reference catalog",
                "source_url": "",
                "category": "compliance_reference",
                "document_id": "ECDAT-COMPLIANCE-CATALOG",
                "version": "2026-09",
                "retrieval_score": float(score),
                "reference_only": True,
            })
    return sorted(scored, key=lambda item: (-item["retrieval_score"], item["title"]))[:max(1, limit)]
