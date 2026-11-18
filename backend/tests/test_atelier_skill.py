from backend.app.services.atelier.skill_loader import load_style_contract


def test_style_contract_has_ink_gongbi48():
    contract = load_style_contract()
    assert contract.name == "InkGongbi48"
    assert len(contract.palette) == 48
    assert len(set(contract.palette)) == 48
    assert contract.canvas == (960, 540)
    assert contract.base_size == 64
    assert contract.light_direction == "top-left"
    assert "Pixel Asset Master" in contract.skill_md


def test_style_contract_palette_matches_spec_lock():
    contract = load_style_contract()
    assert contract.palette[:4] == ["#0e0f12", "#1a1c20", "#26282b", "#33322f"]
    assert contract.palette[-3:] == ["#8f3a30", "#7a5436", "#2c3a4a"]
